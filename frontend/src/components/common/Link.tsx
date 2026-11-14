import { Link as RouterLink, type LinkProps } from "react-router";

// One link surface for the standalone burning frontend.
export function Link(props: LinkProps) {
  return <RouterLink {...props} />;
}
