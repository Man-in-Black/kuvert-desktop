; Kuvert im Windows-Installer als E-Mail-Programm (mailto:) anmelden, damit es unter
; „Einstellungen → Apps → Standard-Apps" auswählbar ist. Festlegen muss es der Nutzer selbst.

!macro customInstall
  WriteRegStr SHCTX "Software\Classes\Kuvert.mailto" "" "Kuvert E-Mail-Link"
  WriteRegStr SHCTX "Software\Classes\Kuvert.mailto\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\Kuvert.mailto\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr SHCTX "Software\Clients\Mail\Kuvert" "" "Kuvert"
  WriteRegStr SHCTX "Software\Clients\Mail\Kuvert\Capabilities" "ApplicationName" "Kuvert"
  WriteRegStr SHCTX "Software\Clients\Mail\Kuvert\Capabilities" "ApplicationDescription" "E-Mail, Kalender, Kontakte und Chat"
  WriteRegStr SHCTX "Software\Clients\Mail\Kuvert\Capabilities\URLAssociations" "mailto" "Kuvert.mailto"
  WriteRegStr SHCTX "Software\RegisteredApplications" "Kuvert" "Software\Clients\Mail\Kuvert\Capabilities"
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Classes\Kuvert.mailto"
  DeleteRegKey SHCTX "Software\Clients\Mail\Kuvert"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "Kuvert"
!macroend
