import { useEffect, useState } from "react";

/** Returns `value` after it has been stable for `delayMs`. Use to debounce
 * search inputs so list loads fire per pause, not per keystroke. */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
