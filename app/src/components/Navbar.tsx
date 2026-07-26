import SideRail from './SideRail';

/**
 * Thin backward-compat wrapper: older imports expect a `Navbar` component.
 * The app shell's navigation lives in SideRail (design.md §7.1).
 */
export default SideRail;
export { SideRail };
