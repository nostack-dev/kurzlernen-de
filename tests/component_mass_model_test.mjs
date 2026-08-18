import assert from 'node:assert/strict';
import {DEFAULT_COMPONENT_MASSES_KG,deriveQuadMassProperties} from '../sim/component_mass_model.mjs';
const base=deriveQuadMassProperties({spanM:.225,propDiameterM:.127});
const expected=DEFAULT_COMPONENT_MASSES_KG.frame+4*DEFAULT_COMPONENT_MASSES_KG.motorEach+4*DEFAULT_COMPONENT_MASSES_KG.propEach+DEFAULT_COMPONENT_MASSES_KG.battery+DEFAULT_COMPONENT_MASSES_KG.esc+DEFAULT_COMPONENT_MASSES_KG.fcRx+DEFAULT_COMPONENT_MASSES_KG.cameraVtx+DEFAULT_COMPONENT_MASSES_KG.wiringHardware;
assert.ok(Math.abs(base.massKg-expected)<1e-12);assert.ok(Math.abs(base.massKg-.720)<1e-12);
assert.equal(base.components.length,17);assert.ok(base.Ixx>0&&base.Iyy>0&&base.Izz>0);assert.ok(Math.abs(base.inertiaTensorKgM2[0][1]-base.inertiaTensorKgM2[1][0])<1e-14);assert.ok(Math.abs(base.inertiaTensorKgM2[0][2]-base.inertiaTensorKgM2[2][0])<1e-14);
const forwardBattery=deriveQuadMassProperties({spanM:.225,propDiameterM:.127,placementM:{batteryX:.045}});assert.ok(forwardBattery.centerM[0]>base.centerM[0]+.007,'battery placement must move CoM');assert.ok(forwardBattery.Iyy>base.Iyy,'moving battery away from CoM must increase pitch inertia');
const heavyMotors=deriveQuadMassProperties({spanM:.225,propDiameterM:.127,massesKg:{motorEach:.060}});assert.ok(heavyMotors.massKg>base.massKg);assert.ok(heavyMotors.Izz>base.Izz,'outer motor mass must raise yaw inertia');
console.log(`Component mass model passed: ${(base.massKg*1000).toFixed(0)} g, CoM ${base.centerM.map(v=>(v*1000).toFixed(2)).join('/')} mm, I ${base.Ixx.toFixed(6)}/${base.Iyy.toFixed(6)}/${base.Izz.toFixed(6)} kg m^2.`);
