import type {ButtonHTMLAttributes, ReactNode} from 'react';

/**
 * The app's button. `primary` for the main action of a page or dialog, `secondary` (outlined) for the others,
 * `ghost` for quiet actions next to text (Reset, Add an action), `danger` to confirm a deletion. `icon` goes before
 * the label. Buttons default to `type="button"`; pass `type="submit"` in forms.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({variant = 'secondary', size = 'md', icon, children, className = '', type = 'button', ...rest}:
  ButtonHTMLAttributes<HTMLButtonElement> & {variant?: ButtonVariant; size?: 'sm' | 'md'; icon?: ReactNode}) {
  return <button type={type} className={`ui-button ui-button-${variant} ui-button-${size} ${className}`.trim()} {...rest}>{icon}{children}</button>;
}
