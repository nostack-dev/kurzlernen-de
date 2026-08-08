#include "Arondight45_Navigation.hpp"

namespace hw::navigation {

// Generic/CI production build: manual flight remains available, GAME mode fails
// closed. Real hardware must replace this translation unit with a concrete
// navigation/range implementation; no weak-symbol override or hidden fallback.
bool sample(fc::NavigationState& out) {
    out = {};
    return false;
}

}  // namespace hw::navigation
