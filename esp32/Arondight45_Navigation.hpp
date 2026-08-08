#pragma once

#include "Arondight45_StateControl.hpp"

namespace hw::navigation {

// Production navigation is an explicit hardware dependency. A hardware build that
// enables GAME mode must link exactly one implementation of sample().
bool sample(fc::NavigationState& out);

}  // namespace hw::navigation
