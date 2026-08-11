import { useEffect, useState } from "react";

export default function useDebouncedValue(value, delay = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedValue(value);
    }, Math.max(0, Number(delay) || 0));

    return () => window.clearTimeout(timeoutId);
  }, [value, delay]);

  return debouncedValue;
}
