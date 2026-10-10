#!/usr/bin/env bash
# Builds the production and the HIL firmware for the ESP32-S31 inside the ESP-IDF image
# (CI: s31-hil.yml runs it with the repository mounted at the working directory).
set -euxo pipefail
. "$IDF_PATH/export.sh"
python "$IDF_PATH/tools/idf.py" --version
build(){ # name app.cpp extra-headers…
  local name="$1" app="$2";shift 2
  local dir="/tmp/arondight45-$name";rm -rf "$dir";mkdir -p "$dir/main"
  cp esp32/Arondight45_DroneFC_Core.hpp esp32/Arondight45_StateControl.hpp esp32/Arondight45_HardwareSensors.hpp esp32/Arondight45_FirmwareRuntime.hpp esp32/Arondight45_FlowNav.hpp "$@" "esp32/$app" "$dir/main/"
  printf 'cmake_minimum_required(VERSION 3.16)\ninclude($ENV{IDF_PATH}/tools/cmake/project.cmake)\nproject(arondight45_s31_%s)\n' "$name" >"$dir/CMakeLists.txt"
  printf 'idf_component_register(SRCS "%s" INCLUDE_DIRS ".")\n' "$app" >"$dir/main/CMakeLists.txt"
  (cd "$dir" && python "$IDF_PATH/tools/idf.py" --preview set-target esp32s31 && python "$IDF_PATH/tools/idf.py" --preview build)
}
build production Arondight45_DroneFC_S31.cpp
build hil Arondight45_DroneFC_HIL_S31.cpp esp32/Arondight45_HIL_Protocol.hpp
