# Syncs the Windows Search rules of one Eva vault (#942). It needs no administrator rights.
# Eva writes this file and its input, and runs it with a timeout: SaveAll can hang for hours.
# Input: a UTF-8 JSON file with { vaultPath, excludes, remove }. An exclude is a path from the
# vault root with '/', and a folder ends with '/'.
# Output: one JSON line { added, removed, saved, error }.
# Exit codes: 0 ok, 1 bad input, 2 no Search API, 3 a rule call failed, 4 SaveAll failed.
# Keep this file ASCII: Windows PowerShell 5.1 reads a file with no BOM in the ANSI code page.
param([Parameter(Mandatory = $true)][string]$InputFile)

$ErrorActionPreference = 'Stop'

$interopSource = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace EvaSearchScope
{
    // From searchapi.h. The order of the methods is the vtable: an unused method keeps its slot.
    [ComImport, Guid("AB310581-AC80-11D1-8DF3-00C04FB6EF69"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface ISearchManager
    {
        [PreserveSig] int GetIndexerVersionStr(out IntPtr ppszVersionString);
        [PreserveSig] int GetIndexerVersion(out uint pdwMajor, out uint pdwMinor);
        [PreserveSig] int GetParameter([MarshalAs(UnmanagedType.LPWStr)] string pszName, out IntPtr ppValue);
        [PreserveSig] int SetParameter([MarshalAs(UnmanagedType.LPWStr)] string pszName, IntPtr pValue);
        [PreserveSig] int get_ProxyName(out IntPtr ppszProxyName);
        [PreserveSig] int get_BypassList(out IntPtr ppszBypassList);
        [PreserveSig] int SetProxy(int sUseProxy, int fLocalByPassProxy, uint dwPortNumber, IntPtr pszProxyName, IntPtr pszByPassList);
        [PreserveSig] int GetCatalog([MarshalAs(UnmanagedType.LPWStr)] string pszCatalog, out ISearchCatalogManager ppCatalogManager);
        [PreserveSig] int get_UserAgent(out IntPtr ppszUserAgent);
        [PreserveSig] int put_UserAgent(IntPtr pszUserAgent);
        [PreserveSig] int get_UseProxy(out int pUseProxy);
        [PreserveSig] int get_LocalBypass(out int pfLocalBypass);
        [PreserveSig] int get_PortNumber(out uint pdwPortNumber);
    }

    [ComImport, Guid("AB310581-AC80-11D1-8DF3-00C04FB6EF50"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface ISearchCatalogManager
    {
        [PreserveSig] int get_Name(out IntPtr pszName);
        [PreserveSig] int GetParameter(IntPtr pszName, out IntPtr ppValue);
        [PreserveSig] int SetParameter(IntPtr pszName, IntPtr pValue);
        [PreserveSig] int GetCatalogStatus(out int pStatus, out int pPausedReason);
        [PreserveSig] int Reset();
        [PreserveSig] int Reindex();
        [PreserveSig] int ReindexMatchingURLs(IntPtr pszPattern);
        [PreserveSig] int ReindexSearchRoot(IntPtr pszRootURL);
        [PreserveSig] int put_ConnectTimeout(uint dwConnectTimeout);
        [PreserveSig] int get_ConnectTimeout(out uint pdwConnectTimeout);
        [PreserveSig] int put_DataTimeout(uint dwDataTimeout);
        [PreserveSig] int get_DataTimeout(out uint pdwDataTimeout);
        [PreserveSig] int NumberOfItems(out int plCount);
        [PreserveSig] int NumberOfItemsToIndex(out int plIncrementalCount, out int plNotificationQueue, out int plHighPriorityQueue);
        [PreserveSig] int URLBeingIndexed(out IntPtr pszUrl);
        [PreserveSig] int GetURLIndexingState(IntPtr pszURL, out uint pdwState);
        [PreserveSig] int GetPersistentItemsChangedSink(out IntPtr ppISearchPersistentItemsChangedSink);
        [PreserveSig] int RegisterViewForNotification(IntPtr pszView, IntPtr pViewChangedSink, out uint pdwCookie);
        [PreserveSig] int GetItemsChangedSink(IntPtr pISearchNotifyInlineSite, IntPtr riid, out IntPtr ppv, IntPtr pGUIDCatalogResetSignature, IntPtr pGUIDCheckPointSignature, IntPtr pdwLastCheckPointNumber);
        [PreserveSig] int UnregisterViewForNotification(uint dwCookie);
        [PreserveSig] int SetExtensionClusion(IntPtr pszExtension, int fExclude);
        [PreserveSig] int EnumerateExcludedExtensions(out IntPtr ppExtensions);
        [PreserveSig] int GetQueryHelper(out IntPtr ppSearchQueryHelper);
        [PreserveSig] int put_DiacriticSensitivity(int fDiacriticSensitive);
        [PreserveSig] int get_DiacriticSensitivity(out int pfDiacriticSensitive);
        [PreserveSig] int GetCrawlScopeManager(out ISearchCrawlScopeManager ppCrawlScopeManager);
    }

    [ComImport, Guid("AB310581-AC80-11D1-8DF3-00C04FB6EF55"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface ISearchCrawlScopeManager
    {
        [PreserveSig] int AddDefaultScopeRule([MarshalAs(UnmanagedType.LPWStr)] string pszURL, int fInclude, uint fFollowFlags);
        [PreserveSig] int AddRoot(IntPtr pSearchRoot);
        [PreserveSig] int RemoveRoot([MarshalAs(UnmanagedType.LPWStr)] string pszURL);
        [PreserveSig] int EnumerateRoots(out IntPtr ppSearchRoots);
        [PreserveSig] int AddHierarchicalScope([MarshalAs(UnmanagedType.LPWStr)] string pszURL, int fInclude, int fDefault, int fOverrideChildren);
        [PreserveSig] int AddUserScopeRule([MarshalAs(UnmanagedType.LPWStr)] string pszURL, int fInclude, int fOverrideChildren, uint fFollowFlags);
        [PreserveSig] int RemoveScopeRule([MarshalAs(UnmanagedType.LPWStr)] string pszRule);
        [PreserveSig] int EnumerateScopeRules(out IEnumSearchScopeRules ppSearchScopeRules);
        [PreserveSig] int HasParentScopeRule([MarshalAs(UnmanagedType.LPWStr)] string pszURL, out int pfHasParentRule);
        [PreserveSig] int HasChildScopeRule([MarshalAs(UnmanagedType.LPWStr)] string pszURL, out int pfHasChildRule);
        [PreserveSig] int IncludedInCrawlScope([MarshalAs(UnmanagedType.LPWStr)] string pszURL, out int pfIsIncluded);
        [PreserveSig] int IncludedInCrawlScopeEx([MarshalAs(UnmanagedType.LPWStr)] string pszURL, out int pfIsIncluded, out int pReason);
        [PreserveSig] int RevertToDefaultScopes();
        [PreserveSig] int SaveAll();
        [PreserveSig] int GetParentScopeVersionId([MarshalAs(UnmanagedType.LPWStr)] string pszURL, out int plScopeId);
        [PreserveSig] int RemoveDefaultScopeRule([MarshalAs(UnmanagedType.LPWStr)] string pszURL);
    }

    [ComImport, Guid("AB310581-AC80-11D1-8DF3-00C04FB6EF54"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IEnumSearchScopeRules
    {
        [PreserveSig] int Next(uint celt, out ISearchScopeRule pprgelt, out uint pceltFetched);
        [PreserveSig] int Skip(uint celt);
        [PreserveSig] int Reset();
        [PreserveSig] int Clone(out IEnumSearchScopeRules ppenum);
    }

    [ComImport, Guid("AB310581-AC80-11D1-8DF3-00C04FB6EF53"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface ISearchScopeRule
    {
        [PreserveSig] int get_PatternOrURL([MarshalAs(UnmanagedType.LPWStr)] out string ppszPatternOrURL);
        [PreserveSig] int get_IsIncluded(out int pfIsIncluded);
        [PreserveSig] int get_IsDefault(out int pfIsDefault);
        // Windows 11 answers E_NOTIMPL, so the script never calls it.
        [PreserveSig] int get_FollowFlags(out uint pFollowFlags);
    }

    [ComImport, Guid("7D096C5F-AC08-4F1F-BEB7-5C22C517CE39")]
    public class CSearchManager { }

    public class UserScopeRule
    {
        public string Url;
        public bool IsIncluded;
    }

    // PowerShell cannot cast CSearchManager to ISearchManager, so every COM call stays in C#.
    public class VaultCrawlScope
    {
        private readonly ISearchCrawlScopeManager scopeManager;

        public VaultCrawlScope()
        {
            ISearchManager searchManager = (ISearchManager)new CSearchManager();
            ISearchCatalogManager catalogManager;
            Check("GetCatalog", searchManager.GetCatalog("SystemIndex", out catalogManager));
            Check("GetCrawlScopeManager", catalogManager.GetCrawlScopeManager(out scopeManager));
        }

        private static void Check(string step, int hr)
        {
            if (hr < 0) throw new Exception(string.Format("{0} failed with HRESULT 0x{1:X8}.", step, hr));
        }

        public List<UserScopeRule> UserRulesUnder(string rootUrl)
        {
            List<UserScopeRule> rules = new List<UserScopeRule>();
            IEnumSearchScopeRules enumerator;
            Check("EnumerateScopeRules", scopeManager.EnumerateScopeRules(out enumerator));
            while (true)
            {
                ISearchScopeRule rule; uint fetched;
                int hr = enumerator.Next(1, out rule, out fetched);
                Check("IEnumSearchScopeRules.Next", hr);
                if (hr != 0 || fetched == 0) break;
                string url; int isIncluded; int isDefault;
                Check("get_PatternOrURL", rule.get_PatternOrURL(out url));
                Check("get_IsIncluded", rule.get_IsIncluded(out isIncluded));
                Check("get_IsDefault", rule.get_IsDefault(out isDefault));
                Marshal.ReleaseComObject(rule);
                if (isDefault == 0 && url.StartsWith(rootUrl, StringComparison.OrdinalIgnoreCase))
                    rules.Add(new UserScopeRule { Url = url, IsIncluded = isIncluded != 0 });
            }
            return rules;
        }

        public void AddUserRule(string url, bool include)
        {
            // fOverrideChildren = 1 would delete every exclude below the vault. 1 = FF_INDEXCOMPLEXURLS.
            Check("AddUserScopeRule(" + url + ")", scopeManager.AddUserScopeRule(url, include ? 1 : 0, 0, 1));
        }

        public void RemoveRule(string url)
        {
            Check("RemoveScopeRule(" + url + ")", scopeManager.RemoveScopeRule(url));
        }

        public void SaveAll()
        {
            Check("SaveAll", scopeManager.SaveAll());
        }
    }
}
'@

$result = [ordered]@{ added = @(); removed = @(); saved = $false; error = $null }

function Stop-Sync([int]$ExitCode, [string]$Reason) {
    $result.error = $Reason
    $result | ConvertTo-Json -Compress | Write-Output
    exit $ExitCode
}

function Get-Reason($ErrorRecord) {
    $exception = $ErrorRecord.Exception
    while ($null -ne $exception.InnerException) { $exception = $exception.InnerException }
    return $exception.Message
}

# 1. The input, and the rules that it asks for.
try {
    $request = Get-Content -LiteralPath $InputFile -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
    Stop-Sync 1 "The input file cannot be read: $(Get-Reason $_)"
}
[string]$vaultPath = $request.vaultPath
if ([string]::IsNullOrWhiteSpace($vaultPath) -or -not [IO.Path]::IsPathRooted($vaultPath)) {
    Stop-Sync 1 "The vault path must be absolute: $vaultPath"
}
$vaultFullPath = [IO.Path]::GetFullPath($vaultPath).TrimEnd('\')
$vaultRootUrl = "file:///$vaultFullPath\"

$wanted = New-Object 'System.Collections.Generic.Dictionary[string,bool]' ([StringComparer]::OrdinalIgnoreCase)
if (-not $request.remove) {
    if (-not (Test-Path -LiteralPath $vaultFullPath -PathType Container)) {
        Stop-Sync 1 "The vault folder does not exist: $vaultFullPath"
    }
    $wanted[$vaultRootUrl] = $true
    foreach ($exclude in @($request.excludes)) {
        [string]$relative = ([string]$exclude).Replace('/', '\').TrimStart('\')
        if ($relative -eq '' -or $relative.Split('\') -contains '..') { continue }
        $wanted[$vaultRootUrl + $relative] = $false
    }
}

# 2. The Search API.
try {
    if (-not ('EvaSearchScope.VaultCrawlScope' -as [type])) { Add-Type -TypeDefinition $interopSource }
    $scope = New-Object EvaSearchScope.VaultCrawlScope
    $existing = $scope.UserRulesUnder($vaultRootUrl)
} catch {
    Stop-Sync 2 "Windows Search is not available: $(Get-Reason $_)"
}

# 3. The changes. The service rewrites a URL when it stores it: '*\node_modules\*' becomes
# '*\node_modules\', and a file rule gets a trailing '\'. So compare a normalized key.
function Get-RuleKey([string]$Url) { $Url.TrimEnd('*').TrimEnd('\').ToLowerInvariant() }

$wantedByKey = @{}
foreach ($rule in $wanted.GetEnumerator()) { $wantedByKey[(Get-RuleKey $rule.Key)] = $rule.Value }

try {
    $kept = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($rule in $existing) {
        [string]$key = Get-RuleKey $rule.Url
        if ($wantedByKey.ContainsKey($key) -and $wantedByKey[$key] -eq $rule.IsIncluded -and -not $kept.Contains($key)) {
            $null = $kept.Add($key)
        } else {
            $scope.RemoveRule($rule.Url)
            $result.removed += $rule.Url
        }
    }
    # The include and the excludes go in one SaveAll, so a secret file is never in the index.
    foreach ($rule in $wanted.GetEnumerator()) {
        if (-not $kept.Contains((Get-RuleKey $rule.Key))) {
            $scope.AddUserRule($rule.Key, $rule.Value)
            $result.added += $rule.Key
        }
    }
} catch {
    Stop-Sync 3 (Get-Reason $_)
}

# 4. A save makes the indexer check its scope again, so it runs only after a change.
if ($result.added.Count -gt 0 -or $result.removed.Count -gt 0) {
    try {
        $scope.SaveAll()
        $result.saved = $true
    } catch {
        Stop-Sync 4 (Get-Reason $_)
    }
}
$result | ConvertTo-Json -Compress | Write-Output
exit 0
