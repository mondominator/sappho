import { useState, useEffect, useRef, useCallback } from 'react';
import { FixedSizeGrid } from 'react-window';

/**
 * VirtualGrid - A virtualized grid component for rendering large collections.
 *
 * Uses react-window's FixedSizeGrid to only render visible items,
 * dramatically improving performance for libraries with hundreds+ items.
 *
 * Props:
 *   items          - Array of items to render
 *   renderItem     - (item, index) => ReactNode - renders a single item
 *   minColumnWidth - Minimum column width in px; actual width is computed to fill the row
 *   rowHeight      - Height of each row in px (defaults to computed column width for square cells)
 *   gap            - Gap between items in px (default 8)
 *   className      - Optional className for the outer container
 *   overscanRowCount - Number of extra rows to render beyond the visible area (default 3)
 */
export default function VirtualGrid({
  items,
  renderItem,
  minColumnWidth = 150,
  rowHeight: rowHeightProp,
  gap = 8,
  className = '',
  overscanRowCount = 3,
}) {
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  // Measure container dimensions using ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const rect = container.getBoundingClientRect();
      setContainerWidth(rect.width);
      // Use viewport height minus container's top offset for scroll area
      const availableHeight = window.innerHeight - rect.top;
      setContainerHeight(availableHeight);
    };

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(container);

    window.addEventListener('resize', measure);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  // Calculate grid dimensions
  const columnCount = containerWidth > 0
    ? Math.max(1, Math.floor((containerWidth + gap) / (minColumnWidth + gap)))
    : 3;
  const actualColumnWidth = containerWidth > 0
    ? (containerWidth - gap * (columnCount - 1)) / columnCount
    : minColumnWidth;
  const rowHeight = rowHeightProp || actualColumnWidth; // Square cells by default
  const rowCount = Math.ceil(items.length / columnCount);

  // Cell renderer for react-window
  const Cell = useCallback(({ columnIndex, rowIndex, style }) => {
    const itemIndex = rowIndex * columnCount + columnIndex;
    if (itemIndex >= items.length) return null;

    const item = items[itemIndex];

    // Adjust style to account for gaps between cells
    const adjustedStyle = {
      ...style,
      left: style.left + columnIndex * gap,
      top: style.top + rowIndex * gap,
      width: actualColumnWidth,
      height: rowHeight,
      padding: 0,
    };

    return (
      <div style={adjustedStyle}>
        {renderItem(item, itemIndex)}
      </div>
    );
  }, [items, columnCount, gap, actualColumnWidth, rowHeight, renderItem]);

  if (!items.length) return null;

  return (
    <div ref={containerRef} className={className} style={{ width: '100%' }}>
      {containerWidth > 0 && (
        <FixedSizeGrid
          columnCount={columnCount}
          columnWidth={actualColumnWidth + gap}
          height={containerHeight}
          rowCount={rowCount}
          rowHeight={rowHeight + gap}
          width={containerWidth + gap}
          overscanRowCount={overscanRowCount}
          style={{ overflowX: 'hidden' }}
        >
          {Cell}
        </FixedSizeGrid>
      )}
    </div>
  );
}
