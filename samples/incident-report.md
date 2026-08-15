# Intrusion summary — "Tin Kettle" (fictional)

A worked example for GIBSEN Studio. Every value below is fabricated; the
addresses are drawn from RFC 5737 / RFC 1918 documentation ranges and the
domains are invented. Drop this file into the studio to see a four-plane
diagram built out of prose.

2024-03-11T22:04:00Z Infrastructure staging observed. The threat actor
registered kettle-invoices.top and stood up a TLS certificate for it. The
domain resolved to 203.0.113.44 throughout the intrusion.

2024-03-12T07:41:00Z Initial access. A phishing email was delivered from
billing@kettle-invoices.top to three staff in the finance team. The lure
carried an attachment named Invoice_Q1_2024.xlsm containing a malicious macro.
T1566.001

2024-03-12T07:58:00Z user: mhollis opened the attachment on workstation
FIN-WS-014. The macro executed powershell.exe, which downloaded a loader from
hxxps://kettle-invoices[.]top/upd/kettle.dll (sha256
9f2c4a1b8e7d6035f4a2b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8). T1059.001

2024-03-12T08:03:00Z The loader established persistence via a Run key at
HKCU\Software\Microsoft\Windows\CurrentVersion\Run\KettleUpdate and began
beaconing to 203.0.113.44 over 443. This is attacker-controlled C2
infrastructure.

2024-03-12T09:15:00Z Credential access. The actor dumped credentials from
lsass on FIN-WS-014 and recovered the CORP\svc-backup service account.

2024-03-12T11:20:00Z Cloud pivot. Using the harvested secret, the actor
authenticated to the Entra ID tenant contoso-eng.onmicrosoft.com and consented
a rogue OAuth grant named "Kettle Reporting" against the Microsoft Graph API.
T1098.003

2024-03-12T13:47:00Z Collection. Mailbox and SharePoint content was collected
through the fraudulent grant and staged into the cloud storage bucket
kettle-drop-eu.

2024-03-13T02:10:00Z Lateral movement. The actor moved laterally to the domain
controller CORP-DC-01 over SMB using the svc-backup credential, then pivoted to
the engineering workstation ENG-WS-03 sitting on the plant network.

2024-03-13T04:35:00Z From ENG-WS-03 the actor connected to the historian
PI-HIST-02 and enumerated the Modbus protocol gateway at 10.20.4.9.

2024-03-13T05:02:00Z Impact. Setpoints were modified on PLC-LINE-2 and the
operator HMI at 10.20.4.21 was left displaying stale values. The safety
instrumented system was not reached. T0836

2024-03-13T06:30:00Z Exfiltration completed. Approximately 40 GB was uploaded
from kettle-drop-eu to 198.51.100.77 before the tenant grant was revoked.
