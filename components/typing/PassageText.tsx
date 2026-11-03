'use client';
import { memo, MutableRefObject, useMemo } from 'react';

export default memo(function PassageText({
  target,
  typed,
  composition,
  charRefs,
}: {
  target: string[];
  typed: string[];
  composition: string;
  charRefs: MutableRefObject<(HTMLSpanElement | null)[]>;
}) {
  const groups = useMemo(() => {
    const result: number[][] = [];
    target.forEach((g, index) => {
      if (index === 0 || g === ' ' || target[index - 1] === ' ')
        result.push([]);
      result[result.length - 1].push(index);
    });
    return result;
  }, [target]);
  return (
    <div className="passage-words" aria-hidden="true">
      {groups.map((indices, group) => (
        <span key={group} className="word-group">
          {indices.map((index) => {
            const state =
              index < typed.length
                ? typed[index] === target[index]
                  ? 'correct'
                  : 'error'
                : 'pending';
            return (
              <span
                key={index}
                ref={(el) => {
                  charRefs.current[index] = el;
                }}
                data-char-index={index}
                data-char-state={state}
                className={`passage-char ${state}`}
              >
                {target[index]}
              </span>
            );
          })}
        </span>
      ))}
      {composition && (
        <span className="composition-preview">{composition}</span>
      )}
    </div>
  );
});
