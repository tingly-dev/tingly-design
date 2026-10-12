/** An action. One primary button per view. */
export interface ButtonProps { label: string; variant?: 'primary' | 'secondary' | 'danger'; disabled?: boolean }
/** A short status or category label. */
export interface BadgeProps { label: string; tone?: 'neutral' | 'brand' | 'positive' | 'negative' | 'warning' }
/** A metric card: a label, the number and one caption line. */
export interface CardProps { label?: string; value: string; caption?: string; trend?: 'up' | 'down' }
/** The topic above a title: "RESULTS · ARR". */
export interface EyebrowProps { text: string }
