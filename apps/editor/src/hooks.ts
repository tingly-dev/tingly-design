import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** The window's inner width, kept up to date as it resizes. */
export function useWindowWidth(): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

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

/** Whether the element has come near the viewport at least once. */
export function useNear<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === 'undefined') return setNear(true);
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setNear(true), { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  return [ref, near];
}
