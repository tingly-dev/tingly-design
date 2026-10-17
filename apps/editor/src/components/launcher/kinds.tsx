import { type ComponentType } from 'react';
import { IconChartBar, IconComponents, IconFileText, IconLayoutDashboard, IconMovie, IconPresentation, type IconProps } from '@tabler/icons-react';
import { type ProjectKind } from '@dc/core';

/** The six project kinds, in the order the launcher lists them. Their words are launcher.kind.<kind>.* */
export const KINDS: { kind: ProjectKind; tone: string }[] = [
  { kind: 'design', tone: 'blue' },
  { kind: 'slides', tone: 'purple' },
  { kind: 'design-system', tone: 'teal' },
  { kind: 'dashboard', tone: 'orange' },
  { kind: 'docs', tone: 'green' },
  { kind: 'motion', tone: 'pink' },
];
export const KIND = Object.fromEntries(KINDS.map((k) => [k.kind, k])) as Record<ProjectKind, (typeof KINDS)[number]>;

const KIND_ICONS: Record<ProjectKind, ComponentType<IconProps>> = {
  design: IconLayoutDashboard,
  slides: IconPresentation,
  'design-system': IconComponents,
  dashboard: IconChartBar,
  docs: IconFileText,
  motion: IconMovie,
};

export function KindIcon({ kind, size = 16 }: { kind: ProjectKind; size?: number }) {
  const I = KIND_ICONS[kind];
  return <I size={size} stroke={1.6} aria-hidden="true" />;
}
