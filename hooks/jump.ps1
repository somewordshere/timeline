# Scrolls the Claude desktop chat to one of your messages, through Windows UI
# Automation (the accessibility interface screen readers use): no keys are sent.
#
# The chat only keeps the messages near its scroll position in the tree, so a
# message that is not there is searched for: the chat is scrolled to its top,
# "Load earlier messages" is pressed until every message is loaded, and the chat
# is then stepped down a page at a time until the message shows up.
#
# stdin: the message's opening words. -Nth picks the nth of the -Count messages
# that open with those words. -DryRun finds the message in what is on screen
# without moving anything. Prints "found", "notfound" or "nowindow"; exits 0 only
# once it scrolled (or, dry, found it).
param([switch]$DryRun, [int]$Nth = 1, [int]$Count = 1, [int]$MaxLoads = 40, [int]$MaxPages = 400)
function Log([string]$m) { [Console]::Error.WriteLine($m) }

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$AE = [Windows.Automation.AutomationElement]
$Scope = [Windows.Automation.TreeScope]
$ScrollP = [Windows.Automation.ScrollPattern]
$NoScroll = [Windows.Automation.ScrollAmount]::NoAmount
$PageDown = [Windows.Automation.ScrollAmount]::LargeIncrement

$words = ([Console]::In.ReadToEnd() -replace '\s+', ' ').Trim()
if ($words -eq '') { 'notfound'; exit 2 }
$prefix = "You said: $words"

function Normalize([string]$s) { ($s -replace '\s+', ' ').Trim() }

# Every element's name and patterns in one cross-process call.
function Get-Elements($root) {
  $cache = New-Object Windows.Automation.CacheRequest
  $cache.Add($AE::NameProperty)
  $cache.Add($AE::BoundingRectangleProperty)
  $cache.Add([Windows.Automation.ScrollItemPattern]::Pattern)
  $cache.Add([Windows.Automation.InvokePattern]::Pattern)
  $null = $cache.Push()
  try { return $root.FindAll($Scope::Descendants, [Windows.Automation.Condition]::TrueCondition) }
  finally { $cache.Pop() }
}

# The rows the message is announced by ("You said: <its text>"), top first.
function Find-Messages($elements) {
  @($elements | Where-Object { $_.Cached.Name -and (Normalize $_.Cached.Name).StartsWith($prefix) } |
    Sort-Object { $_.Cached.BoundingRectangle.Y })
}

function Find-LoadEarlier($elements) {
  foreach ($e in $elements) {
    if ($e.Cached.Name -eq 'Load earlier messages') { return $e }
  }
  return $null
}

# The chat's scroll area: the nearest tall, scrollable ancestor of a message row.
function Find-Chat($elements) {
  $walker = [Windows.Automation.TreeWalker]::ControlViewWalker
  $row = $elements | Where-Object { $_.Cached.Name -like 'You said:*' } | Select-Object -First 1
  if (-not $row) { return $null }
  for ($e = $walker.GetParent($row); $e; $e = $walker.GetParent($e)) {
    $p = $null
    if ($e.TryGetCurrentPattern($ScrollP::Pattern, [ref]$p) -and $p.Current.VerticallyScrollable -and
        $e.Current.BoundingRectangle.Height -gt 200) { return $e }
  }
  return $null
}

function Land($row) {
  $scroll = $null
  if (-not $row.TryGetCachedPattern([Windows.Automation.ScrollItemPattern]::Pattern, [ref]$scroll)) { return $false }
  $scroll.ScrollIntoView()
  return $true
}

$windows = Get-Process -Name Claude -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
if (-not $windows) { 'nowindow'; exit 3 }

foreach ($window in $windows) {
  $root = $AE::FromHandle($window.MainWindowHandle)

  # The app builds its accessibility tree once a client first asks: wait for it.
  $elements = Get-Elements $root
  for ($i = 0; $i -lt 6 -and $elements.Count -lt 50; $i++) {
    Start-Sleep -Milliseconds 300
    $elements = Get-Elements $root
  }

  # A message no other one shares its opening with may be on screen already.
  $near = Find-Messages $elements
  if ($Count -le 1 -and $near.Count -gt 0) {
    if ($DryRun) { 'found'; exit 0 }
    if (Land $near[0]) { 'found'; exit 0 }
  }
  if ($DryRun) { continue }

  $chat = Find-Chat $elements
  if (-not $chat) { Log 'no chat scroll area'; continue }
  $scroll = $chat.GetCurrentPattern($ScrollP::Pattern)
  $was = $scroll.Current.VerticalScrollPercent

  # Load every earlier message, from the chat's top.
  for ($i = 0; $i -lt $MaxLoads; $i++) {
    $scroll.SetScrollPercent($ScrollP::NoScroll, 0)
    Start-Sleep -Milliseconds 250
    $elements = Get-Elements $root
    $more = Find-LoadEarlier $elements
    Log "load $i : button=$([bool]$more) elements=$($elements.Count)"
    if (-not $more) { break }
    $invoke = $null
    if (-not $more.TryGetCachedPattern([Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) { Log 'no invoke pattern'; break }
    $before = $elements.Count
    $invoke.Invoke()
    for ($w = 0; $w -lt 8; $w++) {
      Start-Sleep -Milliseconds 250
      if ((Get-Elements $root).Count -ne $before) { break }
    }
  }

  # Step down a page at a time, counting each matching row once, until the nth.
  $scroll.SetScrollPercent($ScrollP::NoScroll, 0)
  Start-Sleep -Milliseconds 250
  $seen = @{}
  for ($page = 0; $page -lt $MaxPages; $page++) {
    foreach ($row in Find-Messages (Get-Elements $chat)) {
      $id = ($row.GetRuntimeId() -join '.')
      if ($seen.ContainsKey($id)) { continue }
      $seen[$id] = $true
      if ($seen.Count -eq $Nth) {
        Log "found on page $page"
        if (Land $row) { 'found'; exit 0 }
      }
    }
    $at = $scroll.Current.VerticalScrollPercent
    $scroll.Scroll($NoScroll, $PageDown)
    Start-Sleep -Milliseconds 200
    if ($scroll.Current.VerticalScrollPercent -le $at) { Log "bottom after $page pages, $($seen.Count) matches"; break }
  }

  # Not found: put the chat back where it was.
  $scroll.SetScrollPercent($ScrollP::NoScroll, [Math]::Min(100, [Math]::Max(0, $was)))
}
'notfound'; exit 1
