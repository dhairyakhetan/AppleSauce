export { FAQ_ITEMS, type FAQEntry } from '@/content/faq-items';

/* The `FAQ` accordion component that used to live here was deleted.
 * It was never rendered: App.tsx's `<FAQ />` resolves to `pages/FAQ`, and
 * the only import from this module anywhere is `FAQ_ITEMS` (pages/FAQ.tsx).
 * It still carried pre-redesign chrome — `rounded-2xl bg-card shadow-border`
 * cards, a rotating `+` glyph and an inline <style> keyframe block — none of
 * which match the redesign's accordion (see HelpFaqStack, which is the real
 * one). Dead code that can only drift further from the design. FAQ_ITEMS
 * above is live and stays. */
