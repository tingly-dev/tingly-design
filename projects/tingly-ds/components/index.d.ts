/** An action. One primary button per view; brand for the one call to action on a marketing surface. */
export interface ButtonProps { label: string; variant?: 'primary' | 'brand' | 'secondary' | 'danger'; disabled?: boolean }
/** A short status label with a dot: a provider's health, a key's state. */
export interface BadgeProps { label: string; tone?: 'neutral' | 'brand' | 'positive' | 'negative' | 'warning' }
/** A metric card: a label, the number and one caption line. */
export interface CardProps { label?: string; value: string; caption?: string; trend?: 'up' | 'down' }
/** The product and topic above a title: "TINGLY BOX · GATEWAY". */
export interface EyebrowProps { text: string }
