/**
 * Reference Device Library barrel. See ./README.md for full usage docs and
 * REFERENCE_DEVICES.md (repo root) for the source-of-truth letter mapping.
 */
/**
 * PageHeader is THE first-fold system. The owner's verdict on the first
 * overhaul wave was that every page opened on navbar → h1 → content and read
 * as boring and inconsistent; the cause was structural (work scoped per page,
 * so each invented its own restrained opening). Every route should use this
 * so openings vary by colour/ground/accent but cannot drift apart again.
 * Its `children` slot carries the page's real work — search, filters, a CTA —
 * per the "eyecandy yet functional" ruling in VISUAL_DIRECTION.md §9a.
 */
export { PageHeader } from './PageHeader';
export type { PageHeaderProps } from './PageHeader';

export { AngledBanner } from './AngledBanner';
export type { AngledBannerProps } from './AngledBanner';

export { SpeechTag } from './SpeechTag';
export type { SpeechTagProps } from './SpeechTag';

export { StarburstBadge } from './StarburstBadge';
export type { StarburstBadgeProps } from './StarburstBadge';

export { BentoTile } from './BentoTile';
export type { BentoTileProps } from './BentoTile';

export { PillRow } from './PillRow';
export type { PillRowProps, PillRowItem } from './PillRow';

export { SignpostCluster } from './SignpostCluster';
export type { SignpostClusterProps, SignpostPlate } from './SignpostCluster';

export { TicketShape } from './TicketShape';
export type { TicketShapeProps } from './TicketShape';

export { NumberedIndex } from './NumberedIndex';
export type { NumberedIndexProps, NumberedIndexItem } from './NumberedIndex';

export { CutPaperShape } from './CutPaperShape';
export type { CutPaperShapeProps } from './CutPaperShape';

export { AnnotationArrow } from './AnnotationArrow';
export type { AnnotationArrowProps } from './AnnotationArrow';

export { Polaroid } from './Polaroid';
export type { PolaroidProps } from './Polaroid';

export { CircularTextBadge } from './CircularTextBadge';
export type { CircularTextBadgeProps } from './CircularTextBadge';
