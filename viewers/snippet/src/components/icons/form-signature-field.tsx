import { h } from 'preact';
import { IconProps } from './types';

export const FormSignatureFieldIcon = ({
  size = 24,
  strokeWidth = 2,
  primaryColor = 'currentColor',
  className,
  title,
}: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={primaryColor}
    stroke-width={strokeWidth}
    stroke-linecap="round"
    stroke-linejoin="round"
    class={className}
    role="img"
    aria-label={title}
  >
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M21 8v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-8a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2" />
    <path d="M6.4 15.4c2 -2 3 -3.6 3 -4.8c0 -1.8 -.6 -1.8 -1.2 -1.8s-1.22 .65 -1.2 1.8c.02 1.23 .995 2.926 1.5 3.6c.9 1.2 1.5 1.5 2.1 .6l1.2 -1.8c.2 1.6 .8 2.4 1.8 2.4c.318 0 1.583 -1.2 1.8 -1.2c.31 0 .91 .4 1.8 1.2" />
  </svg>
);
