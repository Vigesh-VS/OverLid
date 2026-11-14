; Overlid NSIS hooks.
; On a real uninstall (not an update), take Overlid's hooks out of
; %USERPROFILE%\.claude\settings.json so nothing is left pointing at a
; dead port. The settings backups are kept.

!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    nsExec::Exec '"$INSTDIR\${MAINBINARYNAME}.exe" --remove-hooks'
    Pop $0
  ${EndIf}
!macroend
