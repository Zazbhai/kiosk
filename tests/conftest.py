"""Shared pytest fixtures for kiosk test suite."""

import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

# Ensure brain package is importable
KIOSK_BRAIN = Path(__file__).parent.parent / "brain"
if str(KIOSK_BRAIN.parent) not in sys.path:
    sys.path.insert(0, str(KIOSK_BRAIN.parent))


@pytest.fixture()
def mock_cups_controller():
    """Return a fully mocked CupsController with stubs for all print_file helpers."""
    from brain.cups_controller import CupsController

    mc = MagicMock(spec=CupsController)
    mc.build_cups_options.return_value = {
        "media": "A4",
        "PageSize": "A4",
        "PageRegion": "A4",
        "fit-to-page": "true",
        "print-color-mode": "monochrome",
        "ColorModel": "KGray",
        "sides": "one-sided",
        "Duplex": "None",
    }
    mc.check_usb_printer.return_value = {"isBrother": False, "printerFound": ""}
    mc._get_pdf_page_count.return_value = 3
    mc._extract_pdf_pages.return_value = True
    mc._convert_pdf_to_monochrome.return_value = True
    mc.get_printers.return_value = {
        "success": True,
        "printers": [{"name": "TestPrinter"}],
        "default": "TestPrinter",
    }
    mc.wake_brother_printer = MagicMock()
    return mc
