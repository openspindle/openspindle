# Changelog

## [0.3.0](https://github.com/openspindle/openspindle/compare/v0.2.0...v0.3.0) (2026-10-03)


### Features

* **bed:** Positions are measured from Anchor 1, bed setups keep their own anchors, and probing is chosen by what it does ([#31](https://github.com/openspindle/openspindle/issues/31)) ([0c6c624](https://github.com/openspindle/openspindle/commit/0c6c6245ec672be2a6ea13fc43d2f7584e69c7d2))
* **device:** Edit firmware configuration and tune accessory settings ([#25](https://github.com/openspindle/openspindle/issues/25)) ([782ffb3](https://github.com/openspindle/openspindle/commit/782ffb32d2585c721aec77cdebf62c2489a20992))
* **device:** The camera's video size is set on the Device page, saved settings ask for a reset, and the protocols' sources are Makera's ([#32](https://github.com/openspindle/openspindle/issues/32)) ([eef94c5](https://github.com/openspindle/openspindle/commit/eef94c525f579fb6892efde349ae3cfbf1ae6337))
* **fusion:** Import NC programs directly from Fusion 360 ([#15](https://github.com/openspindle/openspindle/issues/15)) ([37b81ca](https://github.com/openspindle/openspindle/commit/37b81ca2bf5245508f1d102c3a01ecbad9c15bce))
* **fusion:** Imports from Fusion place the stock and its fixtures where the setup has them, and the connection survives restarts ([#29](https://github.com/openspindle/openspindle/issues/29)) ([ad3963d](https://github.com/openspindle/openspindle/commit/ad3963d06b235e9566c5b437c9cb3cfcb804af1a))
* Generate solder-mask paths and share compatible fixtures ([#37](https://github.com/openspindle/openspindle/issues/37)) ([b5c7327](https://github.com/openspindle/openspindle/commit/b5c732727f7f3cd2df598e4b7a768ba9c8f90355))
* **import:** A program's stock markers give a new plate its stock, where it sits and its work origin ([#22](https://github.com/openspindle/openspindle/issues/22)) ([5d15c46](https://github.com/openspindle/openspindle/commit/5d15c46a8e0ea8e83c91748401a17c4245f026e1))
* **import:** Importing asks where a program goes, how to split it and how to fix what the Z1 would not run ([#16](https://github.com/openspindle/openspindle/issues/16)) ([4e7bfc1](https://github.com/openspindle/openspindle/commit/4e7bfc162fede093d0837a13b54c2d9e69fea358))
* **job:** The Job tab follows the machine live and shows its work origin, and every check is one rule list ([#20](https://github.com/openspindle/openspindle/issues/20)) ([8df9583](https://github.com/openspindle/openspindle/commit/8df958351d0947dcfa7d6873e08c964cb0224879))
* **machine:** The machine runs in a process of its own, and programs are prepared on a worker thread ([#26](https://github.com/openspindle/openspindle/issues/26)) ([e103b6a](https://github.com/openspindle/openspindle/commit/e103b6a6cce41c3a772bac478b8fc6421ee7dfb5))
* **motion:** Emulated firmware motions and improved diagnostic functions ([#33](https://github.com/openspindle/openspindle/issues/33)) ([c5098b6](https://github.com/openspindle/openspindle/commit/c5098b6d77f7707170bc3bed023bf556d9579e45))
* **pcb:** PCB preparation is built in without plugins ([#21](https://github.com/openspindle/openspindle/issues/21)) ([f8dc549](https://github.com/openspindle/openspindle/commit/f8dc549b37da5ce239a5ff61fa5de9886b5ccedd))
* **plugins:** The PCB plugin comes with OpenSpindle and uses the pcb2gcode you install ([#11](https://github.com/openspindle/openspindle/issues/11)) ([bf4ca7c](https://github.com/openspindle/openspindle/commit/bf4ca7c23ed4890cc6c47f46cafe59def2ea8e54))
* **plugins:** The plugin card is tidier and Mill drill is a PCB operation of its own ([#13](https://github.com/openspindle/openspindle/issues/13)) ([f42bf59](https://github.com/openspindle/openspindle/commit/f42bf59fcc9e87121e72e2f3dc58ddcc6b75f370))
* **prepare:** The stock's swatch sets its material and colour, and the stock dialog can apply a material ([#36](https://github.com/openspindle/openspindle/issues/36)) ([946c754](https://github.com/openspindle/openspindle/commit/946c754376d62e6bc9771ad0266ac9765a6ba447))
* **probing:** 3D probing finds a corner or center with the Makera 3D Probe and sets the work origin there ([#14](https://github.com/openspindle/openspindle/issues/14)) ([757fc29](https://github.com/openspindle/openspindle/commit/757fc29b9fac2945672d5fcf313382f6664da643))
* **probing:** Probes are tools from the library, and a probing operation is a probe and a strategy ([#24](https://github.com/openspindle/openspindle/issues/24)) ([fb412c8](https://github.com/openspindle/openspindle/commit/fb412c88133ecf34949a5b6801b90202835a93d7))
* **settings:** Settings is a dialog, and its General page chooses the display and mono fonts ([#19](https://github.com/openspindle/openspindle/issues/19)) ([b591eb7](https://github.com/openspindle/openspindle/commit/b591eb7d40d1348e1741ca7448ba79df0a290be4))
* **simulator:** The app runs a simulated Z1, its camera picture matches the Z1's, and the Device page sets its speed ([#28](https://github.com/openspindle/openspindle/issues/28)) ([f7acf35](https://github.com/openspindle/openspindle/commit/f7acf357215344016008e9c7761559fc268e4cf1))
* **tools:** The Dreanique catalog has ball nose, O-flute and aluminium end mills with cutting presets ([#10](https://github.com/openspindle/openspindle/issues/10)) ([9644328](https://github.com/openspindle/openspindle/commit/9644328a3478212c06d8fd13db1f1aa07d0a7c12))
* **tools:** The Dreanique catalog has the ECP3F chamfer mills ([#18](https://github.com/openspindle/openspindle/issues/18)) ([baeac47](https://github.com/openspindle/openspindle/commit/baeac47e8a4c935e09e44b9987961989a4ada5fe))


### Bug Fixes

* **fusion:** The program list keeps working in long Fusion sessions, and Fusion's code dialog closes once connected ([#23](https://github.com/openspindle/openspindle/issues/23)) ([370ed11](https://github.com/openspindle/openspindle/commit/370ed11060712e828394bd6e073abaa047a7f666))
* **import:** A program placed from Anchor 1 keeps its work origin relative to it, so Run sets the machine's work X and Y ([#30](https://github.com/openspindle/openspindle/issues/30)) ([8c0f5a3](https://github.com/openspindle/openspindle/commit/8c0f5a34a10a6b16393aab8d072a8da67f792dbd))
* **tracking:** The 3D probe's routines are followed from where it touched, and it is drawn without its plug ([#35](https://github.com/openspindle/openspindle/issues/35)) ([53e8a13](https://github.com/openspindle/openspindle/commit/53e8a13a6c140dc0117b166c0e3eb2bb02c140e7))

## [0.2.0](https://github.com/openspindle/openspindle/compare/v0.1.0...v0.2.0) (2026-09-28)


### Features

* **plugins:** Plugins with a companion install from a GitHub URL ([#9](https://github.com/openspindle/openspindle/issues/9)) ([a043466](https://github.com/openspindle/openspindle/commit/a0434665d7f16774799e9daf0ef83ce434e1fcbc))


### Bug Fixes

* Concise README ([#5](https://github.com/openspindle/openspindle/issues/5)) ([8e8f1bc](https://github.com/openspindle/openspindle/commit/8e8f1bcbe9142b52372915b1819cab606d78a4ce))
