# Design System Master — SearchEngine (Lively Bento Soft-UI)

> Check `pages/[page].md` first if present; otherwise use this file.

**Project:** SearchEngine  
**Style:** Bento Grids + Soft UI Evolution  
**Dials:** Variance **8** · Motion **7** · Density **7**  
**Stack:** Next.js + Tailwind + Lucide  

---

## Color system (multi-accent)

| Role | Hex | Token |
|------|-----|-------|
| Primary / violet | `#6D28D9` / `#7C3AED` | `--primary` / `--violet` |
| Accent / cyan | `#0891B2` | `--accent` / `--cyan` |
| Teal | `#0D9488` | `--teal` |
| Amber | `#D97706` | `--amber` |
| Canvas | `#F6F4FC` | `--bg-base` |
| Surface | `#FFFFFF` | `--bg-elevated` |
| Ink | `#1E1B4B` | `--fg` |
| Rail | gradient `#1A1035 → #0B1F2E` | `--rail-bg` |

### Module moods
- **Dataset** (`data-mood="dataset"`): violet mood tokens  
- **Web** (`data-mood="web"`): cyan mood tokens  

CTAs use `--mood-grad` (violet↔cyan or cyan↔indigo).

---

## Typography
- Display: **Space Grotesk** (`--font-space`)
- Body: **DM Sans** (`--font-dm-sans`)
- Mono: **JetBrains Mono**

---

## Motion
| Class | Use |
|-------|-----|
| `.anim-enter` | Page / empty hero enter |
| `.anim-stagger > *` | Bento cards / chips cascade |
| `.anim-message` | Chat bubble appear |
| `.hover-lift` | Cards, evidence, list rows |
| `.chat-step-pill--running` | Soft pulse |

`@media (prefers-reduced-motion: reduce)` flattens non-essential animation.

---

## Layout pattern
Dark multi-glow rail · history sidebar · chat center · inspector  
Empty states: **bento-grid** with varied card spans + tinted chips.

---

## Scope
Visual liveliness only — no new product APIs. All prior functions preserved.
