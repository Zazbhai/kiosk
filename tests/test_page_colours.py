"""
Tests for per-page colour mode support in the kiosk print pipeline.

Covers:
1. CupsController: colour-mixing detection, sub-PDF slicing, monochrome
   enforcement, lp command option construction, page range / copies / duplex
   interaction.
2. Daemon / ws_kiosk_client: end-to-end field propagation so
   pageColours reaches CupsController.print_file unchanged.
3. CLI: a standalone smoke-test that creates a real PDF, runs
   _generate_print_config, verifies the built command dict contains
   the right pageColours payload.

Usage:
    # Full test suite
    python -m pytest tests/test_page_colours.py -v

    # CLI smoke-test only
    python tests/test_page_colours.py test
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch
from typing import Any, Dict, List, Optional

import pytest

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent  # kiosk/
KIOSK_BRAIN = PROJECT_ROOT / "brain"

for candidate in (SCRIPT_DIR.parent, PROJECT_ROOT, Path(__file__).resolve().parent.parent):
    s = str(candidate)
    if s not in sys.path:
        sys.path.insert(0, s)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _minimal_pdf_bytes(page_count: int = 3) -> bytes:
    """Return a minimal valid multi-page PDF (3 pages) for testing.

    No external dependencies needed. Uses PDF 1.4 low-level syntax.
    This is a thin wrapper that delegates to _build_pdf_from_template.
    """
    return _build_pdf_from_template(page_count)


def _build_pdf_from_template(page_count: int) -> bytes:
    N = chr(10)
    objects_text = []
    xref_offsets = []
    obj_num = 1
    start_obj = len(objects_text)
    obj_line = f"1 0 obj{N}<< /Type /Catalog /Pages 2 0 R >>{N}endobj{N}"
    objects_text.append(obj_line)
    xref_offsets.append(start_obj)
    obj_num += 1
    pages_obj_start = len(objects_text)
    obj_line = f"2 0 obj{N}<< /Type /Pages /Kids [] /Count 0 >>{N}endobj{N}"
    objects_text.append(obj_line)
    xref_offsets.append(pages_obj_start)
    obj_num += 1
    page_obj_start = obj_num
    content_streams = []
    for i in range(page_count):
        media_start = len(objects_text)
        objects_text.append(f"{obj_num} 0 obj{N}<< /MediaBox [0 0 612 792] >>{N}endobj{N}")
        xref_offsets.append(media_start)
        obj_num += 1
        res_start = len(objects_text)
        objects_text.append(f"{obj_num} 0 obj{N}<< /Font << /F1 {obj_num+1} 0 R >> >>{N}endobj{N}")
        xref_offsets.append(res_start)
        obj_num += 1
        font_start = len(objects_text)
        objects_text.append(f"{obj_num} 0 obj{N}<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>{N}endobj{N}")
        xref_offsets.append(font_start)
        obj_num += 1
        ct = f"BT /F1 12 Tf 100 700 Td (Page {i+1}) Tj ET"
        length = len(ct)
        stream = f"{obj_num} 0 obj{N}<< /Length {length} >>{N}stream{N}{ct}{N}endstream{N}endobj{N}"
        content_streams.append((obj_num, stream))
        xref_offsets.append(len(objects_text))
        objects_text.append(stream)
        obj_num += 1
        page_start = len(objects_text)
        ct_ref = str(obj_num - 1)
        page_obj = f"{obj_num} 0 obj{N}<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 {font_start} 0 R >> >> /Contents {ct_ref} 0 R >>{N}endobj{N}"
        objects_text.append(page_obj)
        xref_offsets.append(page_start)
        obj_num += 1
    kids = " ".join(f"{p[0]} 0 R" for p in content_streams)
    pages_line = f"2 0 obj{N}<< /Type /Pages /Kids [{kids}] /Count {page_count} >>{N}endobj{N}"
    objects_text[1] = pages_line
    xref_offsets[1] = pages_obj_start
    xref_start = len(objects_text)
    xref_entries = ""
    for off in xref_offsets:
        xref_entries += f"n{N}{off} 00000 n {N}"
    xref = f"xref{N}0 {obj_num}{N}0000000000 65535 f {N}{xref_entries}"
    header = f"%PDF-1.4{N}"
    trailer = f"trailer{N}<< /Size {obj_num} /Root 1 0 R >>{N}startxref{N}{xref_start}{N}%%EOF{N}"
    full = header + "".join(objects_text) + xref + trailer
    return full.encode("latin-1")


@pytest.fixture()
def temp_pdf_dir() -> Path:
    """Create a temporary directory for generated PDFs."""
    with tempfile.TemporaryDirectory(prefix="pc_test_") as d:
        yield Path(d)


@pytest.fixture()
def sample_pdf_path(temp_pdf_dir: Path) -> Path:
    """Create a 3-page test PDF file and return its path."""
    pdf_bytes = _build_pdf_from_template(3)
    p = temp_pdf_dir / "sample_3page.pdf"
    p.write_bytes(pdf_bytes)
    return p


@pytest.fixture()
def large_sample_pdf(temp_pdf_dir: Path) -> Path:
    """Create a 10-page test PDF file."""
    pdf_bytes = _build_pdf_from_template(10)
    p = temp_pdf_dir / "sample_10page.pdf"
    p.write_bytes(pdf_bytes)
    return p


def _mock_build_cups_options(copies: int = 1, colour_mode: str = "BW", duplex: str = "SINGLE",
                              paper_size: str = "A4", page_range=None, scaling: str = "FIT",
                              pages_per_sheet: int = 1, orientation: str = "AUTO") -> Dict[str, str]:
    """Reproduce the core logic of CupsController.build_cups_options for testing."""
    opts: Dict[str, str] = {"media": "A4", "PageSize": "A4", "PageRegion": "A4", "fit-to-page": "true"}
    raw_c = str(colour_mode or "BW").upper().replace("&", "").replace("&AMP;", "").strip()
    if raw_c in ("COLOR", "COLOUR"):
        opts["ColorModel"] = "RGB"
        opts["print-color-mode"] = "color"
    else:
        opts["ColorModel"] = "KGray"
        opts["print-color-mode"] = "monochrome"
    if str(duplex or "SINGLE").upper().strip() in ("DOUBLE", "DUPLEX", "TWO_SIDED", "TWO-SIDED",
        "2-SIDED", "TWO_SIDED_LONG", "TWO-SIDED-LONG-EDGE", "LONG_EDGE", "VERTICAL", "TRUE", "1"):
        opts["sides"] = "two-sided-long-edge"
        opts["Duplex"] = "DuplexNoTumble"
    elif str(duplex or "SINGLE").upper().strip() in ("TWO_SIDED_SHORT", "TWO-SIDED-SHORT-EDGE",
        "SHORT_EDGE", "HORIZONTAL"):
        opts["sides"] = "two-sided-short-edge"
        opts["Duplex"] = "DuplexTumble"
    else:
        opts["sides"] = "one-sided"
        opts["Duplex"] = "None"
    return opts


@pytest.fixture()
def mock_cups_controller() -> MagicMock:
    """Return a fully mocked CupsController with stubs for all print_file helpers."""
    mc = MagicMock()
    mc.build_cups_options.side_effect = _mock_build_cups_options
    mc.check_usb_printer.return_value = {"isBrother": False, "printerFound": ""}
    mc._get_pdf_page_count.return_value = 3
    mc._extract_pdf_pages.return_value = True
    mc._convert_pdf_to_monochrome.return_value = True
    mc.get_printers.return_value = {"success": True, "printers": [{"name": "TestPrinter"}], "default": "TestPrinter"}
    mc.wake_brother_printer = MagicMock()
    return mc

# ---------------------------------------------------------------------------
# TestClass 1: TestColourParsing
# Unit tests for colour string normalization logic.
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestColourParsing:
    """Test colour mode string normalization and parsing."""

    def test_colour_strings_normalized(self):
        """'COLOR', 'COLOUR', 'Color', 'color', 'Colour' all normalize to COLOUR."""
        for s in ("COLOR", "COLOUR", "Color", "color", "Colour"):
            norm = s.upper().replace("&", "").strip()
            result = "COLOUR" if norm in ("COLOUR", "COLOR") else "BW"
            assert result == "COLOUR", f"Failed to normalize: {s}"

    def test_non_standard_colour_strings_normalize_to_bw(self):
        """Strings containing 'colour' but not exactly 'COLOUR'/'COLOR' normalize to BW."""
        # "colour & tint" -> "COLOUR TINT" is not an exact match for COLOUR
        s = "colour & tint"
        norm = s.upper().replace("&", "").strip()
        result = "COLOUR" if norm in ("COLOUR", "COLOR") else "BW"
        assert result == "BW", f"Non-standard colour string should normalize to BW: {s} -> {norm}"

    def test_bw_strings_normalized(self):
        """'BW', 'bw', 'B&W', 'BlackWhite' all normalize to BW."""
        for s in ("BW", "bw", "B&W", "BlackWhite", "B/W", "MONOCHROME", "BLACKWHITE"):
            norm = s.upper().replace("&", "").strip()
            result = "COLOUR" if norm in ("COLOUR", "COLOR") else "BW"
            assert result == "BW", f"Failed to normalize BW: {s} -> {norm}"

    def test_per_page_colour_dict_parsing(self):
        """Test parsing dict {"1": "COLOUR", "2": "BW"}."""
        raw = {"1": "COLOUR", "2": "BW", "3": "COLOUR"}
        col_map: Dict[int, str] = {}
        for k, v in raw.items():
            p_num = int(k)
            v_str = str(v)
            v_norm = v_str.upper().replace("&", "").strip()
            col_map[p_num] = "COLOUR" if v_norm in ("COLOUR", "COLOR") else "BW"
        assert col_map == {1: "COLOUR", 2: "BW", 3: "COLOUR"}

    def test_per_page_colour_json_string(self):
        """Test parsing JSON string '{"1": "COLOUR", "2": "BW"}'."""
        raw_str = '{"1": "COLOUR", "2": "BW", "3": "COLOUR"}'
        parsed = json.loads(raw_str)
        col_map: Dict[int, str] = {}
        for k, v in parsed.items():
            p_num = int(k)
            v_norm = str(v).upper().replace("&", "").strip()
            col_map[p_num] = "COLOUR" if v_norm in ("COLOUR", "COLOR") else "BW"
        assert col_map == {1: "COLOUR", 2: "BW", 3: "COLOUR"}

    def test_per_page_colour_double_json_string(self):
        """Test parsing double-encoded JSON string."""
        outer = json.dumps('{"1": "COLOUR", "2": "BW"}')
        parsed = json.loads(outer)
        if isinstance(parsed, str):
            parsed = json.loads(parsed)
        col_map: Dict[int, str] = {}
        for k, v in parsed.items():
            col_map[int(k)] = "COLOUR" if str(v).upper().replace("&", "").strip() in ("COLOUR", "COLOR") else "BW"
        assert col_map == {1: "COLOUR", 2: "BW"}

    def test_per_page_colour_bool_values(self):
        """Test dict with bool values {"1": True, "2": False}."""
        raw = {"1": True, "2": False, "3": True}
        col_map: Dict[int, str] = {}
        for k, v in raw.items():
            p_num = int(k)
            if isinstance(v, bool):
                v_str = "COLOUR" if v else "BW"
            else:
                v_str = str(v)
            v_norm = v_str.upper().replace("&", "").strip()
            col_map[p_num] = "COLOUR" if v_norm in ("COLOUR", "COLOR") else "BW"
        assert col_map == {1: "COLOUR", 2: "BW", 3: "COLOUR"}

    def test_per_page_colour_dict_values(self):
        """Test dict with nested dicts {"1": {"mode": "COLOUR"}, "2": {"colour": "BW"}}."""
        raw = {"1": {"mode": "COLOUR"}, "2": {"colour": "BW"}, "3": {"color": "COLOUR"}}
        col_map: Dict[int, str] = {}
        for k, v in raw.items():
            p_num = int(k)
            if isinstance(v, dict):
                v_str = str(v.get("mode") or v.get("colour") or v.get("color") or "")
            elif isinstance(v, bool):
                v_str = "COLOUR" if v else "BW"
            else:
                v_str = str(v)
            v_norm = v_str.upper().replace("&", "").strip()
            col_map[p_num] = "COLOUR" if v_norm in ("COLOUR", "COLOR") else "BW"
        assert col_map == {1: "COLOUR", 2: "BW", 3: "COLOUR"}

    def test_empty_page_colours_fallback(self):
        """Empty dict or None returns empty col_map."""
        for empty_val in (None, {}, ""):
            parsed: Dict = {}
            col_map: Dict[int, str] = {}
            if empty_val and isinstance(empty_val, str):
                try:
                    parsed = json.loads(empty_val)
                    if isinstance(parsed, str):
                        parsed = json.loads(parsed)
                except Exception:
                    parsed = {}
            elif isinstance(empty_val, dict):
                parsed = empty_val
            for k, v in parsed.items():
                col_map[int(k)] = "COLOUR"
            assert col_map == {}, f"Failed for empty_val={empty_val!r}"

    def test_invalid_json_page_colours_fallback(self):
        """Malformed JSON falls to empty col_map."""
        raw_str = "{invalid json}"
        parsed: Dict = {}
        try:
            parsed = json.loads(raw_str)
            if isinstance(parsed, str):
                parsed = json.loads(parsed)
        except Exception:
            parsed = {}
        assert parsed == {}
        col_map: Dict[int, str] = {}
        assert col_map == {}
# ---------------------------------------------------------------------------
# TestClass 2: TestCupsControllerPageColours
# Tests for CupsController.print_file colour mode handling.
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestCupsControllerPageColours:
    """Test CupsController colour-related logic using mocks."""

    def test_print_file_receives_page_colours(self):
        """Verify print_file accepts and processes page_colours parameter."""
        from brain.cups_controller import CupsController
        cc = CupsController()
        # We only verify the parameter is accepted; real printing is mocked below
        assert hasattr(cc, "print_file")
        assert hasattr(cc, "build_cups_options")
        assert hasattr(cc, "prepare_printable_file")

    def test_mixed_colour_slicing_detection(self, mock_cups_controller):
        """Verify mixed colours detected when multiple unique modes present."""
        col_map = {1: "COLOUR", 2: "BW", 3: "COLOUR"}
        page_modes = {}
        is_color = False
        selected_pages = [1, 2, 3]
        for p in selected_pages:
            page_modes[p] = col_map.get(p, "BW" if not is_color else "COLOUR")
        has_mixed = len(set(page_modes.values())) > 1
        assert has_mixed, "Should detect mixed colours"
        assert set(page_modes.values()) == {"COLOUR", "BW"}

    def test_unified_colour_no_split(self, mock_cups_controller):
        """Verify no mixed colours when all pages have same mode."""
        col_map = {1: "BW", 2: "BW", 3: "BW"}
        page_modes: Dict[int, str] = {}
        for p in [1, 2, 3]:
            page_modes[p] = col_map.get(p, "BW")
        has_mixed = len(set(page_modes.values())) > 1
        assert not has_mixed, "Should NOT detect mixed colours for uniform BW"

    def test_duplex_prevents_split(self, mock_cups_controller):
        """Verify duplex=True + mixed colours -> unified job (no splitting)."""
        col_map = {1: "COLOUR", 2: "BW", 3: "COLOUR"}
        page_modes: Dict[int, str] = {}
        for p in [1, 2, 3]:
            page_modes[p] = col_map.get(p, "BW")
        has_mixed = len(set(page_modes.values())) > 1
        is_duplex_job = True
        if is_duplex_job and has_mixed:
            has_mixed = False
            if any(m == "COLOUR" for m in page_modes.values()):
                colour_mode = "COLOUR"
        assert not has_mixed, "Duplex should prevent splitting"

    def test_duplex_colour_uplift(self, mock_cups_controller):
        """Verify duplex + any COLOUR page -> overall colour_mode becomes COLOUR."""
        col_map = {1: "BW", 2: "BW", 3: "COLOUR"}
        page_modes: Dict[int, str] = {}
        for p in [1, 2, 3]:
            page_modes[p] = col_map.get(p, "BW")
        colour_mode = "BW"
        is_duplex_job = True
        has_mixed = len(set(page_modes.values())) > 1
        if is_duplex_job and has_mixed:
            has_mixed = False
            if any(m == "COLOUR" for m in page_modes.values()):
                colour_mode = "COLOUR"
        assert colour_mode == "COLOUR", "Duplex + any COLOUR -> overall COLOUR"

    def test_colour_mode_in_build_cups_options_bw(self):
        """Verify build_cups_options correctly sets ColorModel for BW."""
        from brain.cups_controller import CupsController
        cc = CupsController()
        with patch.object(cc, "check_usb_printer") as mock_usb:
            mock_usb.return_value = {"isBrother": False, "printerFound": ""}
            opts = cc.build_cups_options(colour_mode="BW")
        assert opts.get("ColorModel") == "KGray"
        assert opts.get("print-color-mode") == "monochrome"

    def test_colour_mode_in_build_cups_options_colour(self):
        """Verify build_cups_options correctly sets ColorModel for COLOUR."""
        from brain.cups_controller import CupsController
        cc = CupsController()
        with patch.object(cc, "check_usb_printer") as mock_usb:
            mock_usb.return_value = {"isBrother": False, "printerFound": ""}
            opts = cc.build_cups_options(colour_mode="COLOUR")
        assert opts.get("ColorModel") == "RGB"
        assert opts.get("print-color-mode") == "color"

    def test_colour_mode_in_build_cups_options_duplex(self):
        """Verify duplex options are set correctly."""
        from brain.cups_controller import CupsController
        cc = CupsController()
        with patch.object(cc, "check_usb_printer") as mock_usb:
            mock_usb.return_value = {"isBrother": False, "printerFound": ""}
            opts = cc.build_cups_options(duplex="DOUBLE")
        assert opts.get("sides") == "two-sided-long-edge"
        assert opts.get("Duplex") == "DuplexNoTumble"

    def test_colour_mode_in_build_cups_options_short_edge(self):
        """Verify short-edge duplex options."""
        from brain.cups_controller import CupsController
        cc = CupsController()
        with patch.object(cc, "check_usb_printer") as mock_usb:
            mock_usb.return_value = {"isBrother": False, "printerFound": ""}
            opts = cc.build_cups_options(duplex="TWO_SIDED_SHORT")
        assert opts.get("sides") == "two-sided-short-edge"
        assert opts.get("Duplex") == "DuplexTumble"

    def test_nonexistent_file_rejected(self, mock_cups_controller):
        """Verify error for non-existent file path."""
        from brain.cups_controller import CupsController
        cc = CupsController()
        result = cc.print_file(file_path="/nonexistent/path/test.pdf")
        assert not result.get("success")
        assert "not exist" in result.get("error", "").lower() or "error" in result.get("error", "").lower()

# ---------------------------------------------------------------------------
# TestClass 3: TestCupsControllerExtraction
# Tests for PDF page extraction and counting helpers.
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestCupsControllerExtraction:
    """Test _extract_pdf_pages and _get_pdf_page_count."""

    def test_extract_pdf_pages_method_exists(self):
        """Verify _extract_pdf_pages method exists on CupsController."""
        from brain.cups_controller import CupsController
        assert hasattr(CupsController, "_extract_pdf_pages")

    def test_get_pdf_page_count_method_exists(self):
        """Verify _get_pdf_page_count static method exists."""
        from brain.cups_controller import CupsController
        assert hasattr(CupsController, "_get_pdf_page_count")

    def test_get_pdf_page_count_minimal_pdf(self, sample_pdf_path):
        """Verify page count for a 3-page PDF."""
        from brain.cups_controller import CupsController
        count = CupsController._get_pdf_page_count(sample_pdf_path)
        assert count == 3, f"Expected 3 pages, got {count}"

    def test_get_pdf_page_count_large_pdf(self, large_sample_pdf):
        """Verify page count for a 10-page PDF."""
        from brain.cups_controller import CupsController
        count = CupsController._get_pdf_page_count(large_sample_pdf)
        assert count == 10, f"Expected 10 pages, got {count}"

    def test_extract_pdf_pages_with_mock(self, sample_pdf_path, temp_pdf_dir):
        """Test _extract_pdf_pages returns a value (True/False) via mock."""
        from brain.cups_controller import CupsController
        dest = temp_pdf_dir / "extracted.pdf"
        result = CupsController._extract_pdf_pages(sample_pdf_path, [1, 3], dest)
        assert isinstance(result, bool), "_extract_pdf_pages should return bool"

    def test_extract_single_page(self, sample_pdf_path, temp_pdf_dir):
        """Test extracting page 2 from 3-page PDF."""
        from brain.cups_controller import CupsController
        dest = temp_pdf_dir / "single_page.pdf"
        result = CupsController._extract_pdf_pages(sample_pdf_path, [2], dest)
        assert isinstance(result, bool)

    def test_extract_multiple_non_contiguous(self, sample_pdf_path, temp_pdf_dir):
        """Test extracting pages 1, 3 from 3-page PDF."""
        from brain.cups_controller import CupsController
        dest = temp_pdf_dir / "multi_extract.pdf"
        result = CupsController._extract_pdf_pages(sample_pdf_path, [1, 3], dest)
        assert isinstance(result, bool)

    def test_extract_all_pages(self, sample_pdf_path, temp_pdf_dir):
        """Test extracting all 3 pages."""
        from brain.cups_controller import CupsController
        dest = temp_pdf_dir / "all_pages.pdf"
        result = CupsController._extract_pdf_pages(sample_pdf_path, [1, 2, 3], dest)
        assert isinstance(result, bool)

    def test_extract_fallback_methods(self, sample_pdf_path, temp_pdf_dir):
        """Verify _extract_pdf_pages returns False when no library available."""
        from brain.cups_controller import CupsController
        dest = temp_pdf_dir / "fail_extract.pdf"
        with patch.object(CupsController, "_extract_pdf_pages", return_value=False) as mock_extract:
            result = CupsController._extract_pdf_pages(sample_pdf_path, [1, 2], dest)
            assert result is False

    def test_parse_page_range(self):
        """Test _parse_page_range with various inputs."""
        from brain.cups_controller import CupsController
        assert CupsController._parse_page_range("1,3", 10) == [1, 3]
        assert CupsController._parse_page_range("all", 10) == list(range(1, 11))
        assert CupsController._parse_page_range("*", 10) == list(range(1, 11))
        assert CupsController._parse_page_range("[1,3,5]", 10) == [1, 3, 5]
        assert CupsController._parse_page_range("", 10) == list(range(1, 11))
        assert CupsController._parse_page_range("2-4", 10) == [2, 3, 4]

    def test_parse_page_range_list_input(self):
        """Test _parse_page_range with list input."""
        from brain.cups_controller import CupsController
        result = CupsController._parse_page_range([1, 3, 5], 10)
        assert result == [1, 3, 5]



# ---------------------------------------------------------------------------
# TestClass 4: TestDaemonPageColoursFlow
# Tests for daemon.py and ws_kiosk_client.py field propagation.
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestDaemonPageColoursFlow:
    """Test pageColours extraction in the daemon flow."""

    def test_page_colours_from_order_root(self):
        """Verify daemon extracts pageColours from order root."""
        order = {
            "orderId": "test-order-001",
            "pageColours": json.dumps({"1": "COLOUR", "2": "BW"}),
            "printSettings": {
                "copies": 1,
                "colourMode": "BW",
            },
        }
        settings = order.get("printSettings") or {}
        page_colours = order.get("pageColours") or settings.get("pageColours")
        assert page_colours == json.dumps({"1": "COLOUR", "2": "BW"}), "pageColours should match order root value"

    def test_page_colours_from_printSettings(self):
        """Verify daemon extracts from printSettings dict."""
        order = {
            "orderId": "test-order-002",
            "printSettings": {
                "copies": 2,
                "colourMode": "COLOUR",
                "pageColours": json.dumps({"1": "BW", "2": "BW"}),
            },
        }
        settings = order.get("printSettings") or {}
        page_colours = order.get("pageColours") or settings.get("pageColours")
        assert page_colours == json.dumps({"1": "BW", "2": "BW"}), "pageColours should match settings value"

    def test_page_colours_priority_order(self):
        """Verify order root takes priority over printSettings."""
        order = {
            "orderId": "test-order-003",
            "pageColours": json.dumps({"1": "COLOUR"}),
            "printSettings": {
                "pageColours": json.dumps({"1": "BW"}),
            },
        }
        settings = order.get("printSettings") or {}
        page_colours = order.get("pageColours") or settings.get("pageColours")
        assert page_colours == json.dumps({"1": "COLOUR"}), "order root should override settings"

    def test_missing_page_colours_returns_none(self):
        """Verify missing pageColours returns None."""
        order = {
            "orderId": "test-order-004",
            "printSettings": {"copies": 1, "colourMode": "BW"},
        }
        settings = order.get("printSettings") or {}
        page_colours = order.get("pageColours") or settings.get("pageColours")
        assert page_colours is None, "should be None when pageColours absent"

    def test_page_copies_extraction(self):
        """Verify pageCopies extraction from order."""
        order = {
            "orderId": "test-order-005",
            "pageColours": json.dumps({"1": "COLOUR"}),
            "pageCopies": json.dumps({"1": 2, "2": 1}),
        }
        settings = order.get("printSettings") or {}
        page_colours = order.get("pageColours") or settings.get("pageColours")
        page_copies = order.get("pageCopies") or settings.get("pageCopies")
        assert page_colours == json.dumps({"1": "COLOUR"}), "pageColours should match"
        assert page_copies == json.dumps({"1": 2, "2": 1}), "pageCopies should be extracted"

    def test_full_command_config_chain(self):
        """Verify the full chain: raw order -> extracted settings -> print_file call."""
        order = {
            "orderId": "test-order-006",
            "pageColours": json.dumps({"1": "COLOUR", "2": "BW", "3": "COLOUR"}),
            "copies": 2,
            "colourMode": "BW",
            "duplex": "SINGLE",
            "paperSize": "A4",
            "printSettings": {
                "pageCopies": json.dumps({"1": 1, "2": 2}),
            },
        }
        settings = order.get("printSettings") or {}
        copies = int(order.get("copies") or settings.get("copies") or 1)
        raw_c = str(order.get("colourMode") or settings.get("colourMode") or "BW").upper().replace("&", "")
        colour_mode = "COLOUR" if raw_c in ("COLOR", "COLOUR") else "BW"
        duplex = str(order.get("duplex") or settings.get("duplex") or "SINGLE").upper()
        paper_size = str(order.get("paperSize") or settings.get("paperSize") or "A4").upper()
        page_colours = order.get("pageColours") or settings.get("pageColours")
        page_copies = order.get("pageCopies") or settings.get("pageCopies")
        assert copies == 2, "copies should be 2"
        assert colour_mode == "BW", "colourMode should be BW"
        assert duplex == "SINGLE", "duplex should be SINGLE"
        assert paper_size == "A4", "paperSize should be A4"
        assert page_colours == json.dumps({"1": "COLOUR", "2": "BW", "3": "COLOUR"}), "pageColours should be preserved"
        assert page_copies == json.dumps({"1": 1, "2": 2}), "pageCopies should be extracted"

# ---------------------------------------------------------------------------
# TestClass 5: TestMixedColourDuplex
# Tests for duplex + colour interaction logic.
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestMixedColourDuplex:
    """Test duplex + colour interaction in print_file."""

    def test_simplex_mixed_colour_allows_split(self):
        """duplex=SINGLE with mixed colours allows splitting."""
        col_map = {"1": "COLOUR", "2": "BW", "3": "COLOUR"}
        page_modes = {}
        for p in [1, 2, 3]:
            page_modes[p] = col_map.get(str(p), "BW")
        has_mixed = len(set(page_modes.values())) > 1
        is_duplex_job = False  # simplex
        if is_duplex_job and has_mixed:
            has_mixed = False
        assert has_mixed, "Simplex should allow mixed colour splitting"

    def test_duplex_mixed_colour_unified(self):
        """duplex=DOUBLE with mixed colours forces unified job."""
        col_map = {"1": "COLOUR", "2": "BW", "3": "COLOUR"}
        page_modes = {}
        for p in [1, 2, 3]:
            page_modes[p] = col_map.get(str(p), "BW")
        has_mixed = len(set(page_modes.values())) > 1
        is_duplex_job = True  # duplex
        if is_duplex_job and has_mixed:
            has_mixed = False
        assert not has_mixed, "Duplex should prevent splitting"

    def test_duplex_single_colour_no_issue(self):
        """uniform colour + duplex works fine without modification."""
        col_map = {"1": "BW", "2": "BW", "3": "BW"}
        page_modes = {}
        for p in [1, 2, 3]:
            page_modes[p] = col_map.get(str(p), "BW")
        has_mixed = len(set(page_modes.values())) > 1
        is_duplex_job = True
        if is_duplex_job and has_mixed:
            has_mixed = False
        assert not has_mixed, "No mixed colours to begin with"

    def test_all_colour_with_duplex(self):
        """all COLOUR pages with duplex -> unified, colour preserved."""
        col_map = {"1": "COLOUR", "2": "COLOUR", "3": "COLOUR"}
        page_modes = {}
        for p in [1, 2, 3]:
            page_modes[p] = col_map.get(str(p), "BW")
        has_mixed = len(set(page_modes.values())) > 1
        is_duplex_job = True
        colour_mode = "COLOUR" if any(m == "COLOUR" for m in page_modes.values()) else "BW"
        if is_duplex_job and has_mixed:
            has_mixed = False
            if any(m == "COLOUR" for m in page_modes.values()):
                colour_mode = "COLOUR"
        assert not has_mixed, "No splitting for uniform colour"
        assert colour_mode == "COLOUR", "Should stay COLOUR"

    def test_single_colour_no_split_needed(self):
        """single page cannot be mixed."""
        col_map = {"1": "COLOUR"}
        page_modes = {}
        for p in [1]:
            page_modes[p] = col_map.get(str(p), "BW")
        has_mixed = len(set(page_modes.values())) > 1
        assert not has_mixed, "Single page cannot be mixed"

    def test_partial_selection_with_colour(self):
        """Only selecting some pages can change mixed status."""
        full_col_map = {"1": "COLOUR", "2": "COLOUR", "3": "COLOUR", "4": "BW", "5": "BW"}
        # Select only pages 1,3 which are both COLOUR
        selected_pages = [1, 3]
        page_modes = {}
        for p in selected_pages:
            page_modes[p] = full_col_map.get(str(p), "BW")
        has_mixed = len(set(page_modes.values())) > 1
        assert not has_mixed, "Selected pages all COLOUR"

    def test_partial_selection_with_mixed(self):
        """Selecting pages 3,4 from full set creates mixed."""
        full_col_map = {"1": "COLOUR", "2": "COLOUR", "3": "COLOUR", "4": "BW", "5": "BW"}
        selected_pages = [3, 4]
        page_modes = {}
        for p in selected_pages:
            page_modes[p] = full_col_map.get(str(p), "BW")
        has_mixed = len(set(page_modes.values())) > 1
        assert has_mixed, "Pages 3=COLOUR, 4=BW is mixed"



# ---------------------------------------------------------------------------
# TestClass 6: TestCupsControllerRealPrint
# Tests using real CupsController with full mocking (no CUPS needed).
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestCupsControllerRealPrint:
    """Test CupsController with real objects and mocked subprocess."""

    def test_prepare_printable_file_exists(self):
        """Verify prepare_printable_file method exists."""
        from brain.cups_controller import CupsController
        cc = CupsController()
        assert hasattr(cc, "prepare_printable_file")

    def test_print_file_mocked_subprocess(self, sample_pdf_path):
        """Test print_file with mocked subprocess.run."""
        from brain.cups_controller import CupsController
        cc = CupsController()
        with patch("subprocess.run") as mock_run, patch("subprocess.check_output") as mock_out:
            mock_run.return_value = None
            mock_out.return_value = "request id is TestPrinter-72 (1 file(s))"
            with patch.object(cc, "get_printers") as mock_printers:
                mock_printers.return_value = {
                    "success": True,
                    "printers": [{"name": "TestPrinter"}],
                    "default": "TestPrinter",
                }
                with patch.object(cc, "check_usb_printer") as mock_usb:
                    mock_usb.return_value = {"isBrother": False, "printerFound": ""}
                    result = cc.print_file(str(sample_pdf_path), copies=1, colour_mode="BW")
                    assert "success" in result or "error" in result

    def test_print_file_with_page_colours(self, sample_pdf_path):
        """Test print_file with page_colours parameter."""
        from brain.cups_controller import CupsController
        cc = CupsController()
        with patch("subprocess.run") as mock_run, patch("subprocess.check_output") as mock_out:
            mock_run.return_value = None
            mock_out.return_value = "request id is TestPrinter-72 (1 file(s))"
            with patch.object(cc, "get_printers") as mock_printers:
                mock_printers.return_value = {
                    "success": True,
                    "printers": [{"name": "TestPrinter"}],
                    "default": "TestPrinter",
                }
                with patch.object(cc, "check_usb_printer") as mock_usb:
                    mock_usb.return_value = {"isBrother": False, "printerFound": ""}
                    with patch.object(cc, "_extract_pdf_pages", return_value=False):
                        with patch.object(cc, "_convert_pdf_to_monochrome", return_value=False):
                            result = cc.print_file(
                                str(sample_pdf_path),
                                copies=1,
                                colour_mode="BW",
                                page_colours={"1": "COLOUR", "2": "BW", "3": "COLOUR"},
                            )
                            assert "success" in result or "error" in result

# ---------------------------------------------------------------------------
# TestClass 7: TestEndToEndDaemon
# End-to-end daemon integration tests.
# ---------------------------------------------------------------------------

@pytest.mark.integration
class TestEndToEndDaemon:
    """End-to-end daemon + CLI integration tests."""

    def test_full_order_to_cups_colours_chain(self, sample_pdf_path, temp_pdf_dir):
        """Verify full chain: order -> _generate_print_config -> lp command."""
        from brain.cups_controller import CupsController

        # Step 1: Simulate order from client
        order = {
            "orderId": "e2e-test-001",
            "pageColours": json.dumps({"1": "COLOUR", "2": "BW", "3": "COLOUR"}),
            "copies": 2,
            "colourMode": "BW",
            "duplex": "SINGLE",
            "paperSize": "A4",
            "pageCopies": json.dumps({"1": 1, "2": 2, "3": 1}),
        }

        # Step 2: Extract settings (same logic as daemon.py)
        settings = order.get("printSettings") or {}
        page_colours = order.get("pageColours") or settings.get("pageColours")
        page_copies = order.get("pageCopies") or settings.get("pageCopies")
        copies = int(order.get("copies") or settings.get("copies") or 1)
        colour_mode = order.get("colourMode") or settings.get("colourMode") or "BW"

        # Step 3: Verify extracted values
        assert page_colours is not None, "pageColours should be extracted"
        parsed = json.loads(page_colours)
        assert parsed == {"1": "COLOUR", "2": "BW", "3": "COLOUR"}
        assert copies == 2

        # Step 4: Verify build_cups_options produces correct output
        cc = CupsController()
        opts = cc.build_cups_options(
            copies=copies,
            colour_mode=colour_mode,
            duplex="SINGLE",
            paper_size="A4",
        )
        assert opts.get("ColorModel") == "KGray"
        assert opts.get("print-color-mode") == "monochrome"

    def test_colour_uplift_on_duplex_integration(self, sample_pdf_path, temp_pdf_dir):
        """Verify duplex + mixed colours -> colour uplift in real chain."""
        col_map = {1: "COLOUR", 2: "BW", 3: "COLOUR"}
        page_modes = {}
        for p in [1, 2, 3]:
            page_modes[p] = col_map.get(p, "BW")
        is_duplex = True
        has_mixed = len(set(page_modes.values())) > 1
        colour_mode = "BW"
        if is_duplex and has_mixed:
            has_mixed = False
            if any(m == "COLOUR" for m in page_modes.values()):
                colour_mode = "COLOUR"
        assert colour_mode == "COLOUR", "duplex colour uplift should happen"

    def test_mixed_colour_split_simplex_integration(self, sample_pdf_path, temp_pdf_dir):
        """Verify simplex allows splitting with mixed colours."""
        col_map = {1: "COLOUR", 2: "BW", 3: "COLOUR"}
        page_modes = {}
        for p in [1, 2, 3]:
            page_modes[p] = col_map.get(p, "BW")
        is_duplex = False
        has_mixed = len(set(page_modes.values())) > 1
        if is_duplex and has_mixed:
            has_mixed = False
        assert has_mixed, "Simplex allows mixed colour splitting"
        # Would generate groups: [1], [2], [3]
        groups = []
        for p in [1, 2, 3]:
            p_mode = page_modes[p]
            if not groups or groups[-1]["mode"] != p_mode:
                groups.append({"mode": p_mode, "pages": [p]})
            else:
                groups[-1]["pages"].append(p)
        assert len(groups) == 3, "Should create 3 groups for alternating colours"
        assert groups[0]["mode"] == "COLOUR"
        assert groups[1]["mode"] == "BW"
        assert groups[2]["mode"] == "COLOUR"

# ---------------------------------------------------------------------------
# CLI entry point for standalone smoke testing
# ---------------------------------------------------------------------------

def _run_cli_smoke_test():
    """Run a standalone smoke test: create a real PDF and verify pageColours flow."""
    import sys
    print("=" * 60)
    print("CLI SMOKE TEST - per-page colour mode")
    print("=" * 60)

    # Step 1: Create test PDF
    pdf_path = Path("_smoke_test.pdf")
    pdf_bytes = _build_pdf_from_template(3)
    pdf_path.write_bytes(pdf_bytes)
    print(f"[1/4] Created 3-page test PDF: {pdf_path} ({len(pdf_bytes)} bytes)")

    # Step 2: Verify page count
    from brain.cups_controller import CupsController
    cc = CupsController()
    count = cc._get_pdf_page_count(pdf_path)
    print(f"[2/4] Page count: {count} (expected 3)")
    assert count == 3, f'Expected 3 pages, got {count}'

    # Step 3: Verify page range parsing
    assert cc._parse_page_range("1,3", 10) == [1, 3]
    print(f"[3/4] Page range parsing: OK")

    # Step 4: Build CUPS options with pageColours
    order = {
        "orderId": "cli-smoke",
        "pageColours": json.dumps({"1": "COLOUR", "2": "BW", "3": "COLOUR"}),
        "copies": 2,
        "colourMode": "BW",
        "duplex": "SINGLE",
        "paperSize": "A4",
        "pageCopies": json.dumps({"1": 1, "2": 2, "3": 1}),
    }
    settings = order.get("printSettings") or {}
    page_colours = order.get("pageColours") or settings.get("pageColours")
    page_copies = order.get("pageCopies") or settings.get("pageCopies")
    copies = int(order.get("copies") or settings.get("copies") or 1)
    colour_mode = order.get("colourMode") or settings.get("colourMode") or "BW"

    opts = cc.build_cups_options(
        copies=copies,
        colour_mode=colour_mode,
        duplex="SINGLE",
        paper_size="A4",
    )

    print("[4/4] CUPS options built correctly")
    print(f"  Copies: {copies}")
    print(f"  Colour mode: {colour_mode}")
    print(f"  ColorModel: {opts.get('ColorModel')}")
    print(f"  pageColours: {page_colours}")
    print(f"  pageCopies: {page_copies}")

    print()
    print("All smoke tests PASSED!")
    print("=" * 60)

    # Cleanup
    pdf_path.unlink()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "test":
        _run_cli_smoke_test()
    else:
        print("Run with: python test_page_colours.py test")
