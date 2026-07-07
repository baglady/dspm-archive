# Mirror the Obsidian vault to D:\forest-vault for forest-ai's offline knowledge.
# Re-run any time before heading out; it's a true mirror (adds/updates/deletes).
#
# EXCLUDED from the mirror (edit these lists to taste):
#   .obsidian  - app settings/plugins, churns constantly, no knowledge value
#   AutoBackup - backups-of-the-vault inside the vault
# To keep personal topics OUT of the assistant's search index, add dirs or
# files here, e.g.:  $xd += 'Archive' ;  $xf += 'Treatment Plan.md','pain.md'

$src = "C:\Users\Begonia\Documents\Obsidian Vault"
$dst = "D:\forest-vault"

$xd = @('.obsidian', 'AutoBackup')
$xf = @('*.zip')

robocopy $src $dst /MIR /XD @($xd | ForEach-Object { Join-Path $src $_ }) /XF $xf /R:1 /W:1 /NFL /NDL /NP
if ($LASTEXITCODE -le 7) {
    $n = (Get-ChildItem $dst -Recurse -Filter *.md -File).Count
    Write-Host "vault mirrored to $dst ($n md files)" -ForegroundColor Green
    exit 0
} else {
    Write-Host "robocopy failed with code $LASTEXITCODE" -ForegroundColor Red
    exit 1
}
