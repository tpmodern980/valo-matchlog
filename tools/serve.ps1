# Kleiner Webserver zum lokalen Testen (nur auf diesem Rechner erreichbar).
# Start: Doppelklick auf server-starten.cmd, dann http://localhost:8123/ im Browser oeffnen.
# Hinweis: bewusst ohne Umlaute, damit Windows PowerShell die Datei immer richtig liest.
param([int]$Port = 8123)

$root = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$prefix = "http://localhost:$Port/"

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.mjs'  = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.webmanifest' = 'application/manifest+json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.webp' = 'image/webp'
  '.ico'  = 'image/x-icon'
  '.woff2' = 'font/woff2'
  '.txt'  = 'text/plain; charset=utf-8'
  '.md'   = 'text/plain; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try { $listener.Start() }
catch {
  Write-Host "Konnte den Server nicht starten. Ist Port $Port schon belegt? ($($_.Exception.Message))"
  exit 1
}
Write-Host "Server laeuft: $prefix"
Write-Host "Ordner: $root"
Write-Host "Beenden mit Strg+C."

function Send-Text($ctx, [int]$status, [string]$text) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($text)
  $ctx.Response.StatusCode = $status
  $ctx.Response.ContentType = 'text/plain; charset=utf-8'
  $ctx.Response.ContentLength64 = $bytes.Length
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
}

try {
  while ($listener.IsListening) {
    # Asynchron warten, damit Strg+C sofort wirkt
    $task = $listener.GetContextAsync()
    while (-not $task.AsyncWaitHandle.WaitOne(250)) { }
    $ctx = $task.GetAwaiter().GetResult()
    try {
      $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
      # Versteckte Ordner und Dateien (.git usw.) nie ausliefern
      $hidden = ($rel -split '[\\/]') | Where-Object { $_.StartsWith('.') }
      $full = [IO.Path]::GetFullPath((Join-Path $root $rel))
      if ((Test-Path -LiteralPath $full -PathType Container)) { $full = Join-Path $full 'index.html' }
      $inside = $full.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)

      if ($ctx.Request.HttpMethod -notin 'GET', 'HEAD') {
        Send-Text $ctx 405 'Nur GET und HEAD.'
      } elseif ($hidden -or -not $inside -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
        Send-Text $ctx 404 'Nicht gefunden.'
      } else {
        $ext = [IO.Path]::GetExtension($full).ToLowerInvariant()
        $type = $mime[$ext]
        if (-not $type) { $type = 'application/octet-stream' }
        $bytes = [IO.File]::ReadAllBytes($full)
        $ctx.Response.StatusCode = 200
        $ctx.Response.ContentType = $type
        # Beim Entwickeln nichts zwischenspeichern
        $ctx.Response.Headers['Cache-Control'] = 'no-store'
        $ctx.Response.ContentLength64 = $bytes.Length
        if ($ctx.Request.HttpMethod -eq 'GET') { $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length) }
      }
      Write-Host ("{0} {1} {2}" -f $ctx.Response.StatusCode, $ctx.Request.HttpMethod, $ctx.Request.Url.PathAndQuery)
    } catch {
      # z. B. Browser hat die Verbindung abgebrochen
      Write-Host "Fehler bei $($ctx.Request.Url.AbsolutePath): $($_.Exception.Message)"
    } finally {
      try { $ctx.Response.Close() } catch { }
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
