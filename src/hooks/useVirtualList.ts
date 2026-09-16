import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface VirtualListOptions<T> {
  itemHeight: number;
  getItemHeight?: (item: T, index: number) => number;
  overscan?: number;
}

export interface VirtualListItem<T> {
  item: T;
  index: number;
}

export function useVirtualList<T>(
  items: T[],
  { getItemHeight, itemHeight, overscan = 4 }: VirtualListOptions<T>,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerNode, setContainerNode] = useState<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const setContainerRef = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node;
    setContainerNode(node);
  }, []);
  const itemOffsets = useMemo(() => {
    const offsets = [0];
    for (let index = 0; index < items.length; index += 1) {
      offsets.push(
        offsets[index] + (getItemHeight ? getItemHeight(items[index], index) : itemHeight),
      );
    }
    return offsets;
  }, [getItemHeight, itemHeight, items]);
  const totalHeight = itemOffsets[itemOffsets.length - 1] ?? 0;

  useEffect(() => {
    if (!containerNode) return;

    const syncSize = () => setViewportHeight(containerNode.clientHeight);
    syncSize();

    const observer = new ResizeObserver(syncSize);
    observer.observe(containerNode);
    return () => observer.disconnect();
  }, [containerNode]);

  useEffect(() => {
    if (!containerNode) return;

    const maxScrollTop = Math.max(0, totalHeight - containerNode.clientHeight);
    if (containerNode.scrollTop > maxScrollTop) {
      containerNode.scrollTop = maxScrollTop;
      setScrollTop(maxScrollTop);
    }
  }, [containerNode, totalHeight]);

  const state = useMemo(() => {
    if (items.length === 0) {
      return {
        visibleItems: [] as VirtualListItem<T>[],
        paddingTop: 0,
        paddingBottom: 0,
      };
    }

    const height = viewportHeight > 0 ? viewportHeight : itemHeight * 10;
    const viewportBottom = scrollTop + height;
    let startIndex = Math.max(0, upperBound(itemOffsets, scrollTop) - 1);
    startIndex = Math.max(0, startIndex - overscan);

    let endIndex = lowerBound(itemOffsets, viewportBottom);
    endIndex = Math.min(items.length, endIndex + overscan);
    const visibleItems = items
      .slice(startIndex, endIndex)
      .map((item, offset) => ({ item, index: startIndex + offset }));

    return {
      visibleItems,
      paddingTop: itemOffsets[startIndex] ?? 0,
      paddingBottom: Math.max(0, totalHeight - (itemOffsets[endIndex] ?? totalHeight)),
    };
  }, [itemHeight, itemOffsets, items, overscan, scrollTop, totalHeight, viewportHeight]);

  return {
    containerRef: setContainerRef,
    containerNode,
    ...state,
    onScroll: () => setScrollTop(containerRef.current?.scrollTop ?? 0),
  };
}

function lowerBound(values: number[], target: number) {
  let left = 0;
  let right = values.length;
  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    if (values[middle] < target) {
      left = middle + 1;
    } else {
      right = middle;
    }
  }
  return left;
}

function upperBound(values: number[], target: number) {
  let left = 0;
  let right = values.length;
  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    if (values[middle] <= target) {
      left = middle + 1;
    } else {
      right = middle;
    }
  }
  return left;
}
