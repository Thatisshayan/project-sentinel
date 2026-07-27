$content = Get-Content -Raw -Path 'D:\AgentDevWork\repos\project-sentinel\scripts\verify.ps1'
$content = $content.Replace("`r`n", "`n")
$bytes = [System.Text.Encoding]::UTF8.GetBytes($content)
if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    Write-Host 'BOM detected - removing'
    $bytes = $bytes[3..($bytes.Length-1)]
}
[System.IO.File]::WriteAllBytes('D:\AgentDevWork\repos\project-sentinel\scripts\verify.ps1', $bytes)
Write-Host 'Fixed verify.ps1'