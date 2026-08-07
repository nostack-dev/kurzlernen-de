from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    s = p.read_text()
    count = s.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one marker, found {count}")
    p.write_text(s.replace(old, new, 1))


replace_once(
    "esp32/Arondight45_StateControl.hpp",
    """        // Learn only the hover baseline; transient maneuver force comes directly from
        // the required specific-force magnitude. This automatically compensates the
        // extra thrust needed while tilted instead of teaching the integrator a turn.
        if (std::fabs(agl_error) < kHoverLearnAglBandM) {
            hover_trim_ = clamp(hover_trim_ + kHoverAdapt * vz_error * dt,
                                kMinHoverTrim, kMaxHoverTrim);
        }
""",
    """        // The actuator-to-thrust scale is aircraft-specific, so hover collective cannot
        // be guessed from simulator constants or assumed hardware. Treat hover_trim_
        // as the slow integral/feed-forward state of the same vertical feedback loop.
        // Every armed, navigation-valid tick integrates vz target minus measured vz.
        // If collective is initially insufficient to leave the ground, the requested
        // motor command therefore rises until the real measured vertical state responds.
        hover_trim_ = clamp(hover_trim_ + kHoverAdapt * vz_error * dt,
                            kMinHoverTrim, kMaxHoverTrim);
""",
)
replace_once(
    "esp32/Arondight45_StateControl.hpp",
    """    static constexpr float kHoverAdapt = 0.050f;
    static constexpr float kHoverLearnAglBandM = 0.50f;
    static constexpr float kInitialHoverThrottle = 0.39f;
""",
    """    static constexpr float kHoverAdapt = 0.050f;
    static constexpr float kInitialHoverThrottle = 0.39f;
""",
)
replace_once(
    "tests/state_control_test.cpp",
    """    CHECK(descend_throttle >= 0.0f);

    // The two translational axes form one desired velocity vector. Its Euclidean
""",
    """    CHECK(descend_throttle >= 0.0f);

    // Collective authority is learned from the same measured vertical-state error,
    // even far below the requested AGL. This lets an unknown real airframe bootstrap
    // from an initially low hover estimate without simulator-specific constants.
    controller.reset();
    rc = base_rc(true);
    nav = {{0.0f, 0.0f, 0.0f}, 0.05f, true};
    transformed = controller.transform(rc, nav, 0.0f, true, 0.001f);
    const float bootstrap_throttle = raw_throttle(transformed.ch[FC_SBUS_THROTTLE]);
    for (int i = 0; i < 1500; ++i)
        transformed = controller.transform(rc, nav, 0.0f, true, 0.001f);
    const float learned_throttle = raw_throttle(transformed.ch[FC_SBUS_THROTTLE]);
    CHECK(controller.hover_trim() > 0.53f);
    CHECK(learned_throttle > bootstrap_throttle + 0.10f);

    // The two translational axes form one desired velocity vector. Its Euclidean
""",
)
replace_once(
    "tests/architecture_invariants.mjs",
    """requireText(\"esp32/Arondight45_StateControl.hpp\",\"std::sqrt(thrust_ratio)\",
            \"thrust magnitude must map through rotor-speed physics instead of linearly to throttle\");
""",
    """requireText(\"esp32/Arondight45_StateControl.hpp\",\"std::sqrt(thrust_ratio)\",
            \"thrust magnitude must map through rotor-speed physics instead of linearly to throttle\");
requireText(\"esp32/Arondight45_StateControl.hpp\",\"hover_trim_ + kHoverAdapt * vz_error * dt\",
            \"collective feed-forward must learn continuously from vertical state error\");
forbidText(\"esp32/Arondight45_StateControl.hpp\",\"kHoverLearnAglBandM\",
           \"collective learning must not be disabled far from the AGL target\");
""",
)

print("collective-integrator patch applied")
