"use client";
import { useRef, useState } from "react";
import { normalize } from "@/lib/coordinates";
import type { Hold } from "@/lib/types";

type Props = {
  src: string;
  holds: Hold[];
  editable?: boolean;
  selectable?: boolean;
  selected?: string;
  onSelect?: (id: string) => void;
  onChange?: (holds: Hold[]) => void;
};
const clampScale = (value: number) => Math.max(1, Math.min(3, value));

export default function HoldMap({
  src,
  holds,
  editable = false,
  selectable = false,
  selected,
  onSelect,
  onChange,
}: Props) {
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    id: string;
    pointer: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; scale: number } | null>(null);
  const suppressClick = useRef(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [scale, setScale] = useState(1);
  const interactive = editable || selectable;
  const position = (x: number, y: number) =>
    normalize(x, y, canvas.current!.getBoundingClientRect());
  const setZoom = (next: number) => setScale(clampScale(next));

  return (
    <div className="photo-map-shell">
      <div
        className={`photo-map ${editable ? "is-editable" : ""} ${selectable ? "is-selectable" : ""} ${interactive ? "is-interactive" : ""}`}
        data-testid="photo-map"
        onPointerDown={(event) => {
          if (!interactive || event.pointerType === "mouse") return;
          event.currentTarget.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
          });
          if (pointers.current.size === 2) {
            const [a, b] = Array.from(pointers.current.values());
            pinch.current = {
              distance: Math.hypot(a.x - b.x, a.y - b.y),
              scale,
            };
          }
        }}
        onPointerMove={(event) => {
          if (!pointers.current.has(event.pointerId)) return;
          pointers.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
          });
          if (pointers.current.size !== 2 || !pinch.current) return;
          const [a, b] = Array.from(pointers.current.values());
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          if (Math.abs(distance - pinch.current.distance) > 3)
            suppressClick.current = true;
          setZoom(pinch.current.scale * (distance / pinch.current.distance));
        }}
        onPointerUp={(event) => {
          pointers.current.delete(event.pointerId);
          if (pointers.current.size < 2) pinch.current = null;
        }}
        onPointerCancel={(event) => {
          pointers.current.delete(event.pointerId);
          pinch.current = null;
        }}
        onClick={(event) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          if (
            !editable ||
            !ready ||
            holds.length >= 200 ||
            event.target !== canvas.current?.querySelector("img")
          )
            return;
          onChange?.([
            ...holds.map((hold) => ({ ...hold, is_top: false })),
            {
              id: crypto.randomUUID(),
              order_index: holds.length + 1,
              ...position(event.clientX, event.clientY),
              is_top: false,
            },
          ]);
          onSelect?.("");
        }}
      >
        <div
          className="photo-map-canvas"
          data-testid="photo-map-canvas"
          ref={canvas}
          style={{ transform: `scale(${scale})` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt="Climbing route with mapped holds"
            draggable={false}
            onLoad={() => setReady(true)}
            onError={() => setFailed(true)}
          />
          {failed && (
            <p role="alert">
              Photo could not load. Return to projects and try opening it again.
            </p>
          )}
          {ready &&
            holds.map((hold) => (
              <button
                key={hold.id}
                type="button"
                className={`hold ${hold.is_top ? "top-hold" : ""} ${selected === hold.id ? "selected" : ""}`}
                style={{ left: `${hold.x * 100}%`, top: `${hold.y * 100}%` }}
                aria-label={`Hold ${hold.order_index}${hold.is_top ? ", TOP" : ""}`}
                aria-pressed={
                  editable || selectable ? selected === hold.id : undefined
                }
                data-testid={`hold-${hold.order_index}`}
                onClick={(event) => {
                  event.stopPropagation();
                  if (editable || selectable) onSelect?.(hold.id);
                }}
                onPointerDown={(event) => {
                  if (!editable || pointers.current.size > 0) return;
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  drag.current = {
                    id: hold.id,
                    pointer: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    moved: false,
                  };
                  onSelect?.(hold.id);
                }}
                onPointerMove={(event) => {
                  const current = drag.current;
                  if (
                    !current ||
                    current.id !== hold.id ||
                    current.pointer !== event.pointerId
                  )
                    return;
                  if (
                    Math.hypot(
                      event.clientX - current.startX,
                      event.clientY - current.startY,
                    ) > 3
                  )
                    current.moved = true;
                  if (current.moved)
                    onChange?.(
                      holds.map((item) =>
                        item.id === hold.id
                          ? {
                              ...item,
                              ...position(event.clientX, event.clientY),
                            }
                          : item,
                      ),
                    );
                }}
                onPointerUp={() => {
                  drag.current = null;
                }}
                onPointerCancel={() => {
                  drag.current = null;
                }}
                onKeyDown={(event) => {
                  if (
                    !editable ||
                    ![
                      "ArrowUp",
                      "ArrowDown",
                      "ArrowLeft",
                      "ArrowRight",
                    ].includes(event.key)
                  )
                    return;
                  event.preventDefault();
                  const step = event.shiftKey ? 0.025 : 0.005;
                  onChange?.(
                    holds.map((item) =>
                      item.id === hold.id
                        ? {
                            ...item,
                            x: Math.max(
                              0,
                              Math.min(
                                1,
                                item.x +
                                  (event.key === "ArrowRight"
                                    ? step
                                    : event.key === "ArrowLeft"
                                      ? -step
                                      : 0),
                              ),
                            ),
                            y: Math.max(
                              0,
                              Math.min(
                                1,
                                item.y +
                                  (event.key === "ArrowDown"
                                    ? step
                                    : event.key === "ArrowUp"
                                      ? -step
                                      : 0),
                              ),
                            ),
                          }
                        : item,
                    ),
                  );
                }}
              >
                <span>{hold.is_top ? "TOP" : hold.order_index}</span>
                <i />
              </button>
            ))}
        </div>
      </div>
      {interactive && ready && (
        <div className="map-zoom" aria-label="Photo zoom controls">
          <button
            type="button"
            aria-label="Zoom out"
            disabled={scale <= 1}
            onClick={() => setZoom(scale - 0.25)}
          >
            −
          </button>
          <button
            type="button"
            aria-label="Reset zoom"
            disabled={scale === 1}
            onClick={() => setScale(1)}
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={scale >= 3}
            onClick={() => setZoom(scale + 0.25)}
          >
            +
          </button>
          <span>Pinch the photo to zoom</span>
        </div>
      )}
    </div>
  );
}
