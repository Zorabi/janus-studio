# Workbench Override

This page overrides the generated Master where noted.

## Concept

**Janus Studio** — a scientific instrument crossed with an experimental
editorial spread. The interface should feel precise and operational first, then
reward exploration with depth, parallax and graph motion.

## Typography Override

- Display: **Syne Variable**, 600–800
- Interface/body: **IBM Plex Mono**, 400–600
- Readability floor: microcopy **12px**, labels **13px**, controls/body **14px**.
- Gremlin editor: fluid **16–18px** with a comfortable line height.
- Use oversized condensed-feeling numerals and tightly tracked uppercase labels.
- Avoid generic sci-fi display fonts and glitch effects.

## Color Refinement

- Canvas: `#080a09`
- Elevated canvas: `#101310`
- Surface: `#151916`
- Bone: `#e9e8df`
- Muted text: `#9da398`
- Acid signal: `#c7ff4a`
- Amber signal: `#e6a854`
- Danger: `#ff6b5f`
- Hairline: `rgba(233, 232, 223, 0.14)`

## Spatial Rules

- Full-viewport instrument layout, not a card dashboard.
- Use hairlines, oversized index numbers and one asymmetric diagonal composition.
- Panels should be planar and clipped, with at most 8px corner radius.
- The topology canvas owns the visual depth; utility surfaces stay matte.
- Navigation is stable; contextual information may slide or crossfade.

## Motion

- Spring motion only for direct manipulation and panel changes.
- Query execution uses one directional scan and graph propagation sequence.
- No decorative infinite bouncing, pulsing or rotating.
- Respect `prefers-reduced-motion`.

## Iconography

- Lucide only, 1.5px stroke, sizes 14 / 16 / 18 / 20.
- No emoji, pictographic fonts or mixed icon families.

## Accessibility

- Every icon-only button has an accessible name and tooltip.
- Visible `:focus-visible` ring in acid signal color.
- Interaction targets are at least 40px on desktop and 44px on narrow layouts.
- State is expressed with text or shape in addition to color.
