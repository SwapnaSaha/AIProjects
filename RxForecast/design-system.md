# RxForecast Design System

**Adapted from:** the Anthropic/Claude Design System (`C:\Swapna\GitHub\Projects\week-5-claudeapp\.claude\knowledge\design-system.md`), which was written for a chat product. This version keeps the token system, aesthetic, and everything genuinely reusable, replaces the chat-specific components (Chat Composer, Message Bubbles, Session List) with the data-table/dashboard components RxForecast actually needs, and adds one new semantic token (`an-critical`) for compliance hard-blocks. See the change log at the bottom for the full diff against the source.

---

## Brand Aesthetic

Clean, warm, minimal. Thoughtful whitespace. No decoration that doesn't earn its place.

RxForecast is a **buyer's daily working tool**, not a chat interface — a pharmacy procurement manager triaging a reorder queue, reviewing a shortage, or approving a PO needs the interface to feel calm and legible under time pressure, the same restraint the source system built for a conversational product. Dark mode is the primary experience for the working product (Queue, Shortages, Forecast, PO detail, Rules, Audit, Dashboard). Light mode is reserved for auth and any print/export-adjacent surface (CSV/PDF export headers).

Because recommendations here carry clinical and compliance weight, one addition to the source brand principle: **nothing in this system should ever imply more certainty than the data supports.** Confidence bands, "insufficient data" states, and compliance hard-blocks are first-class visual states, not afterthoughts — see Semantic Color Usage below.

---

## Color System

Token prefix: `an-` (e.g. `bg-an-bg-base`, `text-an-fg-subtle`) — unchanged from the source system, so any component library built against it drops in without renaming.

### Dark Mode (product — Queue, Shortages, Forecast, PO detail, Rules, Audit, Dashboard)

| Token | Hex | Use |
|---|---|---|
| `an-bg-base` | `#1A1917` | Page / app background |
| `an-bg-subtle` | `#222220` | Sidebar, secondary surfaces |
| `an-bg-surface` | `#2A2927` | Cards, panels, input fields, table rows |
| `an-bg-elevated` | `#333230` | Dropdowns, modals, detail drawer, raw-EDI/audit-payload viewers |
| `an-border-base` | `rgba(255,255,255,0.08)` | Default dividers and borders |
| `an-border-strong` | `rgba(255,255,255,0.14)` | Focused inputs, active states |
| `an-fg-base` | `#F2EFE9` | Primary text |
| `an-fg-subtle` | `#9B9793` | Secondary text, placeholders, metadata |
| `an-fg-muted` | `#6B6864` | Disabled text, timestamps, inactive-rule labels |
| `an-fg-inverted` | `#1A1917` | Text on accent/critical backgrounds |
| `an-accent` | `#D97757` | Primary accent — coral/terracotta |
| `an-accent-hover` | `#C96B49` | Accent hover state |
| `an-accent-subtle` | `rgba(217,119,87,0.15)` | Accent tint for backgrounds |
| `an-success` | `#5B9B6B` | Favorable states — shipped, active rule, savings up |
| `an-warning` | `#C9963A` | Caution states — partial shortage, backordered, pending |
| `an-error` | `#C05B5B` | Recoverable problems — rejected, validation failure, out-of-band quantity |
| **`an-critical`** | **`#7A2020`** *(new)* | **Compliance hard-blocks** — Schedule II auto-sub blocked, DSCSA/340B violation, P0 incident. Solid fill with `an-fg-inverted` text, never just a tint — this must read as categorically different from a normal `an-error` validation message. |

### Light Mode (auth pages)

| Token | Hex | Use |
|---|---|---|
| `an-bg-base` | `#FAF9F7` | Page background |
| `an-bg-subtle` | `#F2F0EC` | Input backgrounds, cards |
| `an-bg-surface` | `#ECEAE5` | Elevated surfaces |
| `an-border-base` | `rgba(0,0,0,0.08)` | Default borders |
| `an-border-strong` | `rgba(0,0,0,0.18)` | Focused inputs |
| `an-fg-base` | `#1A1917` | Primary text |
| `an-fg-subtle` | `#6B6864` | Secondary text |
| `an-fg-muted` | `#9B9793` | Placeholders |
| `an-accent` | `#D97757` | Coral accent (same value) |
| `an-accent-hover` | `#C96B49` | |
| `an-accent-subtle` | `rgba(217,119,87,0.12)` | Tint backgrounds |
| `an-critical` | `#7A2020` | Same value — compliance messaging must read identically in both themes |

### Semantic Color Usage — RxForecast states

The single canonical mapping (referenced by `engg.md` instead of repeating token choices per feature):

| Product state | Token | Where |
|---|---|---|
| Urgency stripe (high/medium/low stockout risk) | `an-error` / `an-warning` / `an-success` | Reorder Queue row |
| Shortage severity chip | `an-error` (full) / `an-warning` (partial) | Shortage Alert Feed |
| PO status stepper stage | `an-success` (shipped/acked) / `an-warning` (backordered) / `an-fg-muted` (pending) | EDI 850 tracker |
| Override rule active/inactive | `an-success` / `an-fg-muted` | Rules list |
| Dashboard trend delta | `an-success` (favorable) / `an-error` (unfavorable) | Director Dashboard |
| "Insufficient data" / cold-start SKU | Neutral — `an-bg-subtle` + `an-fg-subtle`, **not** a warning color | Forecast view, Queue row — this is a data-coverage fact, not a problem to flag red |
| Schedule II / DSCSA / 340B hard-block | **`an-critical`** | Substitution UI, PO Modify/Approve — must be visually distinct from a normal `an-error` |

### Tailwind Config

```js
// tailwind.config.ts — extend colors
colors: {
  an: {
    'bg-base':     'var(--an-bg-base)',
    'bg-subtle':   'var(--an-bg-subtle)',
    'bg-surface':  'var(--an-bg-surface)',
    'bg-elevated': 'var(--an-bg-elevated)',
    'border':      'var(--an-border-base)',
    'border-strong': 'var(--an-border-strong)',
    'fg-base':     'var(--an-fg-base)',
    'fg-subtle':   'var(--an-fg-subtle)',
    'fg-muted':    'var(--an-fg-muted)',
    'fg-inverted': 'var(--an-fg-inverted)',
    'accent':      'var(--an-accent)',
    'accent-hover':'var(--an-accent-hover)',
    'accent-subtle':'var(--an-accent-subtle)',
    'success':     'var(--an-success)',
    'warning':     'var(--an-warning)',
    'error':       'var(--an-error)',
    'critical':    'var(--an-critical)',
  }
}
```

---

## Typography

### Fonts

| Role | Font | Fallback |
|---|---|---|
| UI sans (body, labels, inputs, in-app headings) | **Inter** | system-ui, sans-serif |
| Auth hero only | **Lora** | Georgia, serif |
| Monospace (raw EDI, audit payloads, NDCs) | **JetBrains Mono** | monospace |

```html
<!-- globals.css @import -->
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;450;500;600&family=Lora:wght@500;600&family=JetBrains+Mono:wght@400;500&display=swap');
```

*Change from source: Lora is scoped to the auth hero only.* RxForecast has a page title on nearly every screen (Queue, Shortages, Forecast, PO detail, Rules, Audit, Dashboard) — a serif display on every one of those reads editorial rather than operational for a buyer working through a task list. `text-display` below is Inter, not Lora, for that reason.

### Scale

| Name | Size | Weight | Line Height | Use |
|---|---|---|---|---|
| `text-hero` | 32px | 500, **Lora** | 1.2 | Auth page hero only |
| `text-display` | 28px | **600, Inter** | 1.2 | In-app page titles (Queue, Dashboard, ...) |
| `text-title` | 18px | 500 | 1.3 | Section headings, card titles |
| `text-body` | 14px | 400 | 1.6 | Default body, form labels, descriptions |
| `text-body-sm` | 13px | 400 | 1.5 | Table cells, nav labels, metadata |
| `text-caption` | 12px | 400 | 1.4 | Timestamps, helper text, citation footnotes |
| `text-mono` | 13px | 400 | 1.6 | Raw EDI, audit payloads, NDCs, drug codes |
| `text-label` | 12px | 500 | 1 | Buttons, tabs, badges, status chips |

**Numeric columns** (quantities, prices, MAPE %, days-of-supply): `text-body-sm` / `text-body` with `font-variant-numeric: tabular-nums`, **not** `text-mono` — tabular figures inside Inter keep table columns aligned without making the whole table read like a code block. Reserve `text-mono` for literal machine-format text (EDI segments, NDCs, audit JSON).

---

## Spacing & Layout

### App Shell (product)

```
┌───────────────────────────────────────────────────────┐
│  Sidebar 256px      │  Main content flex-1              │
│  bg-subtle          │  bg-base                          │
│                      │  (Detail Drawer overlays from      │
│                      │   the right when opened, 480px)   │
└───────────────────────────────────────────────────────┘
```

| Zone | Width | Background |
|---|---|---|
| Sidebar (nav) | 256px (fixed) | `an-bg-subtle` |
| Main content | `flex-1` | `an-bg-base` |
| Detail Drawer (overlay, not persistent) | 480px (fixed) | `an-bg-elevated` |

*Change from source:* the chat system's fixed 304px right panel (always-visible chat context) becomes an **overlay** Detail Drawer here — RxForecast's right-hand surface (forecast/PO detail) is opened on demand from a table row, not permanently docked, so it should slide over content with a scrim rather than compress the main column. Full spec under Components → Detail Drawer.

### Sidebar

- Top: Logo + "RxForecast" wordmark (24px padding)
- Nav items (fixed list, not scrollable): Reorder Queue, Shortages, Rules, Audit Trail *(compliance/director only)*, Dashboard *(director only, also the default landing page — clarified 2026-08-17, matches `engg.md` FEATURE_8)* — Forecast view has no direct nav entry, reached via Queue/search
- Each item: icon (Lucide, 20px) + label + optional count badge (unread shortages, queue size)
- Bottom: user avatar + name + role + logout (pinned, 16px padding)

### Main Content Area

- Page header: `text-display` title + primary action (if any) + filter row, 24px bottom padding
- Table/card content: full width minus 24px side padding, `gap: 16px` between sections
- No 680px prose-width constraint (that was chat-message-specific) — tables and dashboards use full available width up to a 1440px max, centered beyond that

### Spacing Units (multiples of 4) — unchanged, fully reusable

```
4px  — tight gaps (icon + label)
8px  — small padding (chips, tags)
12px — compact padding (sm buttons, badges)
16px — standard component padding
20px — medium spacing
24px — section padding
32px — large gaps between sections
40px — page-level breathing room
```

---

## Components

### Buttons — unchanged, one addition

```
Primary   — bg: an-accent, text: white, hover: an-accent-hover
           border-radius: 6px, height: 36px, px: 16px
           font: 14px/500
           Used for: Approve

Ghost     — bg: transparent, text: an-fg-base, border: 1px an-border
           hover: bg-an-bg-surface
           Used for: Modify, Defer

Danger    — bg: an-error tinted, text: an-error
           hover: slightly more opaque
           Used for: Reject

Critical (new) — bg: an-critical (solid), text: an-fg-inverted
           No hover-softening — this button either doesn't exist (action is blocked)
           or, where it must appear (e.g. "Escalate to Pharmacist"), stays fully solid
```

All buttons: `transition duration-150 ease-out`, no shadow.

### Input Fields — unchanged from source

```
height: 36px (single line), padding: 0 12px
background: an-bg-surface
border: 1px solid an-border-base
border-radius: 6px
text: 14px an-fg-base
placeholder: an-fg-muted
focus: border-color an-border-strong, outline: none
```

### Data Table *(new — replaces the source's chat-message-list pattern as RxForecast's primary content surface)*

```
Row height: 44px (default), 36px (dense — Audit Trail)
Header: text-label uppercase, an-fg-subtle, background an-bg-subtle, sticky on scroll
Row background: transparent; hover: an-bg-surface; selected: an-bg-elevated
Priority/urgency stripe: 3px solid left border in an-error/warning/success (Queue only)
Cell padding: 0 16px
Numeric cells: right-aligned, tabular-nums
Pagination: cursor-based for large tables (Audit Trail), page-based elsewhere
Empty state: centered icon + text-body-sm message, no border/card around it
```

### Detail Drawer *(new — replaces the source's fixed chat context panel)*

```
Width: 480px, slides in from the right over a scrim (rgba(0,0,0,0.4))
Background: an-bg-elevated
Animation: translateX(100%) → 0, 150ms ease-out-expo (paired with scrim opacity 0→1)
Close: click scrim, Esc key, or explicit close icon (top-right, 16px)
Header: text-title + close icon, 16px padding, border-bottom 1px an-border-base
Body: scrollable, 16px padding
Footer (when actions present): sticky, border-top, action buttons right-aligned
```

### KPI Stat Tile *(new — Director Dashboard)*

```
Background: an-bg-surface, border 1px an-border-base, border-radius 8px, padding 16px
Label: text-label uppercase, an-fg-subtle
Value: text-display (Inter 600), an-fg-base — or an-accent for the North Star metric specifically
Delta: text-body-sm, an-success/an-error with a small directional arrow icon
```

### Status Stepper *(new — EDI 850 lifecycle: Approved → Transmitted → Acked → Shipped/Backordered)*

```
Horizontal, 4 stages, connected by a 1px an-border-base line (an-success once passed)
Each stage: 8px dot (an-success/an-warning/an-fg-muted per Semantic Color Usage) + text-caption label + timestamp
Current stage: dot filled + pulsing ring (motion: opacity loop, 1.5s, respects prefers-reduced-motion)
```

### Cards / Panels — unchanged from source

```
background: an-bg-surface
border: 1px solid an-border-base
border-radius: 8px
padding: 16px
```

### Badges / Status Chips — unchanged, tokens extended with `an-critical`

```
height: 20px, padding: 0 8px
border-radius: 10px (pill)
font: 11px/500 uppercase tracking-wide
an-accent-subtle bg / an-accent text — active/highlighted
an-bg-surface bg / an-fg-muted text — neutral
an-success/warning/error bg (12% opacity) / matching text — semantic states
an-critical bg (solid) / an-fg-inverted text — compliance hard-block only
```

---

## Iconography — unchanged from source

- **Library:** Lucide React
- **Stroke width:** 1.5px
- **Default size:** 16px (UI), 20px (sidebar nav), 14px (inline with text)
- **Color:** inherit from parent text color
- No filled icons in product UI.

**RxForecast-specific icon mapping** (for consistency across engineers):

| Concept | Icon |
|---|---|
| Reorder Queue | `ListOrdered` |
| Shortage | `AlertTriangle` |
| Approve | `Check` |
| Reject | `X` |
| Audit Trail | `FileText` |
| Compliance hard-block | `ShieldAlert` |
| Dashboard | `LayoutDashboard` |
| Rules / Overrides | `SlidersHorizontal` |

---

## Motion — unchanged from source, one addition

```
duration: 100–150ms
easing: cubic-bezier(0.16, 1, 0.3, 1)  /* ease-out-expo */

Standard transitions:
  opacity: 0 → 1 (150ms) for panels, modals
  translateY(4px) → 0 with opacity for dropdown entrances
  translateX(100%) → 0 with scrim fade for the Detail Drawer (new — horizontal, not vertical, since it's a side panel not a dropdown)
  background-color on hover (100ms)

Never:
  bounce, spring, or scale transforms in product UI
  Animations longer than 200ms on repeated interactions
  Motion on the Status Stepper's "current stage" pulse beyond a slow opacity loop — respects prefers-reduced-motion
```

```css
/* globals.css */
.an-fade-in {
  animation: anFadeIn 150ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes anFadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}

.an-drawer-in {
  animation: anDrawerIn 150ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes anDrawerIn {
  from { transform: translateX(100%); }
  to   { transform: translateX(0); }
}
```

---

## CSS Variables Setup

```css
/* globals.css — dark mode (default) */
:root {
  --an-bg-base:       #1A1917;
  --an-bg-subtle:     #222220;
  --an-bg-surface:    #2A2927;
  --an-bg-elevated:   #333230;
  --an-border-base:   rgba(255,255,255,0.08);
  --an-border-strong: rgba(255,255,255,0.14);
  --an-fg-base:       #F2EFE9;
  --an-fg-subtle:     #9B9793;
  --an-fg-muted:      #6B6864;
  --an-fg-inverted:   #1A1917;
  --an-accent:        #D97757;
  --an-accent-hover:  #C96B49;
  --an-accent-subtle: rgba(217,119,87,0.15);
  --an-success:       #5B9B6B;
  --an-warning:       #C9963A;
  --an-error:         #C05B5B;
  --an-critical:      #7A2020;
}

/* Light mode override (auth pages) */
[data-theme="light"] {
  --an-bg-base:       #FAF9F7;
  --an-bg-subtle:     #F2F0EC;
  --an-bg-surface:    #ECEAE5;
  --an-bg-elevated:   #E4E2DC;
  --an-border-base:   rgba(0,0,0,0.08);
  --an-border-strong: rgba(0,0,0,0.18);
  --an-fg-base:       #1A1917;
  --an-fg-subtle:     #6B6864;
  --an-fg-muted:      #9B9793;
  --an-fg-inverted:   #FAF9F7;
  --an-accent-subtle: rgba(217,119,87,0.12);
  --an-critical:      #7A2020;
}
```

---

## Copy / Voice

- No emoji anywhere in the product UI
- Sentence case for all labels, headings, buttons
- Active voice, short sentences
- "you" for the user, "the agent" or "RxForecast" for AI-generated recommendations (not "Claude" in-product — the model is an implementation detail, not the brand the buyer interacts with)
- Compliance/clinical vocabulary used naturally (NDC, TE code, Schedule II, DSCSA) — do not simplify or avoid terms; this is a professional tool for pharmacy buyers, not a consumer app
- No filler phrases ("Please note that...", "In order to...")
- Error messages: say what happened and what to do, not just a code
- **New — RxForecast-specific:** quantities always show units ("30 tablets," never a bare "30"); drug names are never truncated or abbreviated anywhere in the UI, including table cells and toasts — truncation risk on a drug name is a patient-safety-adjacent defect, not a cosmetic one

---

## Inferences / Decisions

*(Carried from source, plus new entries for this adaptation)*

1. **Typography:** Inter (sans) for both body and in-app display text; Lora scoped to the auth hero only *(changed — source used Lora for all page titles; RxForecast's task-dense screens read better with a single consistent sans)*
2. **Accent color:** `#D97757` — unchanged, works as well for a coral "primary action" accent in an operational tool as it did for a chat brand mark
3. **Dark backgrounds:** unchanged, `#1A1917` warm near-black
4. **No gradients on surfaces** — unchanged, flat layered approach
5. **`an-critical` token added** — the PRD draws an explicit line between recoverable errors (buyer can fix and retry) and compliance hard-blocks (Schedule II auto-sub, DSCSA/340B violations) that must never be softened into "just another red state." One token, reserved exclusively for that distinction.
6. **Chat Composer and Message Bubbles removed** — no conversational surface in the RxForecast MVP; kept the rest of the system's component vocabulary (Buttons, Input Fields, Cards/Panels, Badges) and added Data Table, Detail Drawer, KPI Stat Tile, and Status Stepper, which is what an operational, table-driven procurement tool actually needs.
7. **Right panel → Detail Drawer (overlay, not persistent)** — RxForecast's detail surface (forecast, PO lines) is opened per-row on demand, unlike a chat app's always-present context panel, so it behaves as a dismissible overlay instead of a fixed third column.
8. **Lucide icons, motion system, spacing scale, copy voice** — all unchanged; these were already domain-agnostic and suit a compliance-heavy professional tool well (especially "say what happened and what to do," which matters a lot here).

---

## Change Log Against Source

| Area | Change |
|---|---|
| Title/framing | Retitled; framed for RxForecast instead of a generic chat product |
| Color | Added `an-critical` token (dark + light); added "Semantic Color Usage — RxForecast states" table |
| Typography | Lora scoped to auth hero only (new `text-hero` token); `text-display` now Inter 600 instead of Lora 500; added tabular-nums guidance for numeric table columns |
| Layout | App Shell's fixed 304px right panel → overlay Detail Drawer (480px); Sidebar session list → fixed nav-item list; Chat Area section → Main Content Area section |
| Components | Removed Chat Composer, Message Bubbles; renamed Sidebar Session Item → (folded into Sidebar spec); added Data Table, Detail Drawer, KPI Stat Tile, Status Stepper; added Critical button variant |
| Iconography | Added RxForecast-specific icon mapping table |
| Motion | Added Detail Drawer slide-in animation (translateX) |
| Copy/Voice | Changed AI-response voice from "Claude/the assistant" to "the agent/RxForecast"; added units-on-quantities and no-drug-name-truncation rules |
