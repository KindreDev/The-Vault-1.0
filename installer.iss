; Inno Setup 6 script for The Vault
; Requires: PyInstaller output at dist\vault\
; Output:   dist\VaultSetup.exe

#define AppName      "The Vault"
#define AppVersion   "1.1.2"
#define AppPublisher "The Vault"
#define AppURL       "https://github.com/"
#define AppExeName   "vault.exe"

[Setup]
AppId={{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
AppUpdatesURL={#AppURL}
DefaultDirName={autopf}\TheVault
DefaultGroupName={#AppName}
; Don't require admin — installs to user's AppData\Local if user-mode
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=dist
OutputBaseFilename=VaultSetup
SetupIconFile=frontend\public\favicon.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
DisableDirPage=no
; Allow non-admin install
PrivilegesRequired=lowest
UninstallDisplayName={#AppName}
; DisableWelcomePage=no
LicenseFile=
; The app writes data to %APPDATA%\TheVault, not the install dir
; so the install dir itself can be read-only (Program Files)

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional icons:"

[Files]
; Copy the entire PyInstaller output directory
Source: "dist\vault\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; Start Menu
Name: "{group}\{#AppName}";           Filename: "{app}\{#AppExeName}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
; Desktop (optional, user-selectable)
Name: "{userdesktop}\{#AppName}";     Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Registry]
; Register in Add/Remove Programs with an "Open" verb
Root: HKCU; Subkey: "Software\TheVault"; ValueType: string; ValueName: "InstallDir"; ValueData: "{app}"; Flags: uninsdeletekey

[Run]
; Offer to launch the app when the installer finishes (interactive installs)
Filename: "{app}\{#AppExeName}"; \
  Description: "Launch {#AppName} now"; \
  Flags: nowait postinstall skipifsilent
; Auto-relaunch after a silent auto-update (the running app exits itself, so
; /RESTARTAPPLICATIONS can't bring it back — start it explicitly here instead)
Filename: "{app}\{#AppExeName}"; Flags: nowait; Check: WizardSilent

[UninstallRun]
; Nothing special on uninstall — user data stays in %APPDATA%\TheVault

[Code]
// Show a note about user data after uninstall
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
    MsgBox('The Vault has been uninstalled.' + #13#10 + #13#10 +
           'Your library data (database + thumbnails) is kept at:' + #13#10 +
           ExpandConstant('{userappdata}') + '\TheVault\' + #13#10 + #13#10 +
           'Delete that folder manually if you want to remove all data.',
           mbInformation, MB_OK);
end;
