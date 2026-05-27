fn main() {
    // No custom manifest — let tauri-build embed its default
    // (asInvoker privileges, Common-Controls dependency, DPI awareness).
    //
    // Earlier builds (103..110) requested requireAdministrator via a
    // custom manifest because the rdev WH_KEYBOARD_LL hook is silently
    // refused on some systems without elevation. Live testing in build
    // 110 revealed that elevation triggers Windows UIPI: a non-admin
    // Discord (the typical case) can no longer receive keyboard input
    // while the elevated Companion window has focus, so Discord's own
    // push-to-mute on the same key stops working. The mouse-hotkey
    // path made this especially bad because a Mouse4 click on the
    // Companion window grabs focus mid-press, so the release event is
    // also swallowed and Discord stays muted.
    //
    // Trade-off: users on systems where rdev needs elevation (anti-
    // cheat / strict-hardening) now have to right-click → "Run as
    // administrator" themselves if they want keyboard PTT to work in
    // fullscreen games. We surface that hint in the Settings UI.
    tauri_build::build();
}
