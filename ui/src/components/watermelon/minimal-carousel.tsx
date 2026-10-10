"use client";

import React, { useState } from "react";
import { motion } from "motion/react";
import { MoreHorizontal } from "lucide-react";
import "./minimal-carousel.css";

/* --- Types --- */
export interface CarouselCard {
  id: string;
  title: string;
  value: string;
  color: string;
  icon: React.ElementType;
  renderActions?: (card: CarouselCard) => React.ReactNode;
  fullWidthActions?: boolean;
}

interface MinimalCarouselProps {
  cards: CarouselCard[];
  activeId?: string | null;
  onActiveChange?: (id: string | null) => void;
  onCustomizeClick?: (card: CarouselCard) => void;
}

export const MinimalCarousel: React.FC<MinimalCarouselProps> = ({
  cards,
  activeId: controlledActiveId,
  onActiveChange,
  onCustomizeClick,
}) => {
  const [internalActiveId, setInternalActiveId] = useState<string | null>(
    cards[cards.length - 1]?.id || null
  );

  const activeId = controlledActiveId !== undefined ? controlledActiveId : internalActiveId;

  const setActiveId = (id: string | null) => {
    if (controlledActiveId === undefined) {
      setInternalActiveId(id);
    }
    onActiveChange?.(id);
  };

  const activeCard = cards.find((c) => c.id === activeId);
  const secondaryCards = cards.filter((c) => c.id !== activeId);

  const handleBackgroundClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setActiveId(null);
    }
  };

  const cardTransition = {
    duration: 0.32,
    ease: [0.16, 1, 0.3, 1], // Smooth, high-performance deceleration curve
  };

  return (
    <div className="carousel-root-container">
      <div
        className="carousel-backdrop"
        onClick={handleBackgroundClick}
      >
        <div className="carousel-wrapper">
          <motion.div layout transition={cardTransition} className="carousel-cards-stack">

            {/* Expanded Active Card */}
            {activeCard && (
              <motion.div
                key={activeCard.id}
                layoutId={`carousel-card-${activeCard.id}`}
                className={`expanded-card ${activeCard.color} ${activeCard.fullWidthActions ? 'expanded-full-width' : ''}`}
                transition={cardTransition}
                layout
              >
                <div className="expanded-card-top">
                  <div className="card-top-icon-wrap">
                    <activeCard.icon size={30} />
                  </div>
                </div>

                <div className={`expanded-card-bottom ${activeCard.fullWidthActions ? 'is-full-width' : ''}`}>
                  <div className="expanded-card-header-row">
                    <div className="expanded-card-info">
                      <h3 className="card-main-title">
                        {activeCard.title}
                      </h3>
                      <p className="card-sub-value">
                        {activeCard.value}
                      </p>
                    </div>

                    {!activeCard.fullWidthActions && (
                      <div className="expanded-card-actions">
                        {activeCard.renderActions ? (
                          activeCard.renderActions(activeCard)
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onCustomizeClick?.(activeCard);
                            }}
                            className="edit-pill-btn"
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {activeCard.fullWidthActions && (
                    <div className="expanded-card-full-actions">
                      {activeCard.renderActions ? activeCard.renderActions(activeCard) : null}
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* Grid Layout for Secondary Cards */}
            <motion.div
              layout
              transition={cardTransition}
              className={`secondary-grid ${
                activeId ? "grid-cols-3" : "grid-cols-2"
              }`}
            >
              {(activeId ? secondaryCards : cards).map((card) => (
                <motion.div
                  key={card.id}
                  layoutId={`carousel-card-${card.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveId(card.id);
                  }}
                  transition={cardTransition}
                  layout
                  whileHover={{ y: -3, transition: { duration: 0.15 } }}
                  whileTap={{ scale: 0.98, transition: { duration: 0.1 } }}
                  className={`secondary-card ${card.color}`}
                >
                  <div className="secondary-card-top">
                    <div className="secondary-card-icon-wrap">
                      <card.icon size={activeId ? 22 : 26} />
                    </div>
                    <div className="dots-icon-pill" title="Select card">
                      <MoreHorizontal size={14} />
                    </div>
                  </div>

                  <div className="secondary-card-info">
                    <h4 className="secondary-card-title">
                      {card.title}
                    </h4>
                    <p className="secondary-card-value">
                      {card.value}
                    </p>
                  </div>
                </motion.div>
              ))}
            </motion.div>

          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default MinimalCarousel;
