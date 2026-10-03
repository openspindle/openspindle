; The Windows installer's additions (nsis.include in electron-builder.yml).
;
; NC programs list OpenSpindle under Explorer's Open with, without OpenSpindle becoming the app
; that opens them: they stay with the CAM or editor that opens them now, as on macOS. Associations
; in electron-builder.yml would make it their app on Windows, so these are registered here, for
; the extensions of FILE_KINDS.program in src/platform/contract/files.ts.

!define NC_PROGRAM_CLASS "OpenSpindle.NcProgram"

!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\Classes\${NC_PROGRAM_CLASS}" "" "NC program"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${NC_PROGRAM_CLASS}\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${NC_PROGRAM_CLASS}\shell\open\command" "" '"$appExe" "%1"'
  WriteRegNone SHELL_CONTEXT "Software\Classes\.nc\OpenWithProgids" "${NC_PROGRAM_CLASS}"
  WriteRegNone SHELL_CONTEXT "Software\Classes\.cnc\OpenWithProgids" "${NC_PROGRAM_CLASS}"
  WriteRegNone SHELL_CONTEXT "Software\Classes\.gcode\OpenWithProgids" "${NC_PROGRAM_CLASS}"
  WriteRegNone SHELL_CONTEXT "Software\Classes\.tap\OpenWithProgids" "${NC_PROGRAM_CLASS}"
  WriteRegNone SHELL_CONTEXT "Software\Classes\.ngc\OpenWithProgids" "${NC_PROGRAM_CLASS}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.nc\OpenWithProgids" "${NC_PROGRAM_CLASS}"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.cnc\OpenWithProgids" "${NC_PROGRAM_CLASS}"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.gcode\OpenWithProgids" "${NC_PROGRAM_CLASS}"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.tap\OpenWithProgids" "${NC_PROGRAM_CLASS}"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.ngc\OpenWithProgids" "${NC_PROGRAM_CLASS}"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\${NC_PROGRAM_CLASS}"
!macroend
