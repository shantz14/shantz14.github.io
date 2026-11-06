---
tags:
  - public
  - cs
  - cs/networking
created_on: 05-17-2026
related:
source:
aliases:
---
Web servers have file size limits when sending requests, usually 1 or 10 MB.
So to send larger files you split the upload into chunks.  You now have to include information like the total file size and chunk size.  If you number the chunks you can send them in parallel and let the server arrange the chunks properly.

Use this for file uploads/look up other places this is used for [[HttpGo]]