import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * The inner size (clientWidth × clientHeight) of an element, kept up to date
 * as it resizes. Pass a ref to measure one you already hold, or use the one
 * returned. 0 × 0 until the element is in the page.
 */
export function useElementSize<T extends HTMLElement>(given?: RefObject<T | null>): [RefObject<T | null>, { w: number; h: number }] {
  const own = useRef<T>(null);
  const ref = given ?? own;
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return [ref, size];
}
