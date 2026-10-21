using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Validation;

// Optional developer tool: never referenced by the product or its build.
const int diagnosticLimit = 100;
const long packageLimit = 128L * 1024 * 1024;
const long embeddedLimit = 64L * 1024 * 1024;
var diagnostics = 0;
var failures = 0;
var checkedFiles = 0;
var paths = new SortedSet<string>(StringComparer.Ordinal);

void Error(string message)
{
    failures++;
    if (diagnostics++ < diagnosticLimit)
    {
        // Untrusted XML and filenames must not turn diagnostics into arbitrary terminal output.
        var line = new string(message.Select(c => char.IsControl(c) ? ' ' : c).ToArray());
        Console.Error.WriteLine(line.Length <= 1200 ? line : line[..1200] + " [truncated]");
    }
}

bool IsLink(string path) => (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0;

void Collect(string path)
{
    if (IsLink(path))
    {
        Error($"SKIP symlink: {path}");
        return;
    }
    if (File.Exists(path))
    {
        if (Path.GetExtension(path).Equals(".pptx", StringComparison.OrdinalIgnoreCase))
            paths.Add(Path.GetFullPath(path));
        else
            Error($"Expected a .pptx file: {path}");
        return;
    }
    foreach (var entry in Directory.EnumerateFileSystemEntries(path))
    {
        if (IsLink(entry)) continue;
        if (Directory.Exists(entry)) Collect(entry);
        else if (Path.GetExtension(entry).Equals(".pptx", StringComparison.OrdinalIgnoreCase))
            paths.Add(Path.GetFullPath(entry));
    }
}

void Validate(OpenXmlPackage package, string label)
{
    var validator = new OpenXmlValidator(FileFormatVersions.Office2019)
    {
        // Failure remains failure when diagnostics are capped; stop error enumeration at this cap.
        MaxNumberOfErrors = diagnosticLimit + 1
    };
    foreach (var error in validator.Validate(package))
        Error($"INVALID {label}: {error.Id}: {error.Description}; part={error.Part?.Uri}; path={error.Path?.XPath}");
}

void ValidateEmbedded(OpenXmlPartContainer container, string label, HashSet<OpenXmlPart> seen)
{
    foreach (var relation in container.Parts)
    {
        var part = relation.OpenXmlPart;
        if (!seen.Add(part)) continue;
        if (part is EmbeddedPackagePart embedded)
        {
            var embeddedLabel = $"{label}!{embedded.Uri}";
            // The corpus uses chart workbooks. Other embedded package kinds are not silently blessed.
            if (embedded.ContentType != "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            {
                Error($"UNSUPPORTED embedded package {embeddedLabel}: {embedded.ContentType}");
                continue;
            }
            try
            {
                using var input = embedded.GetStream(FileMode.Open, FileAccess.Read);
                using var buffer = new MemoryStream();
                var chunk = new byte[81920];
                int count;
                while ((count = input.Read(chunk)) > 0)
                {
                    if (buffer.Length + count > embeddedLimit)
                        throw new InvalidDataException("Embedded package exceeds 64 MiB limit.");
                    buffer.Write(chunk, 0, count);
                }
                buffer.Position = 0;
                using var workbook = SpreadsheetDocument.Open(buffer, false,
                    new OpenSettings { MaxCharactersInPart = 16L * 1024 * 1024 });
                Validate(workbook, embeddedLabel);
                ValidateEmbedded(workbook, embeddedLabel, seen);
            }
            catch (Exception ex)
            {
                Error($"UNREADABLE {embeddedLabel}: {ex.GetType().Name}: {ex.Message}");
            }
        }
        ValidateEmbedded(part, label, seen);
    }
}

if (args.Length == 0 || args.Contains("--help"))
{
    Console.WriteLine("Usage: dotnet run --project scripts/validate-pptx -- <file.pptx|directory> [...]");
    Console.WriteLine("Recursively validates PPTX and embedded XLSX with Open XML SDK 3.3.0, Office2019; read-only.");
    return args.Length == 0 ? 2 : 0;
}

foreach (var arg in args)
{
    try { Collect(Path.GetFullPath(arg)); }
    catch (Exception ex) { Error($"INPUT {arg}: {ex.GetType().Name}: {ex.Message}"); }
}
if (paths.Count == 0) Error("No .pptx files found.");
foreach (var path in paths)
{
    checkedFiles++;
    try
    {
        if (new FileInfo(path).Length > packageLimit)
            throw new InvalidDataException("Presentation exceeds 128 MiB limit.");
        using var document = PresentationDocument.Open(path, false,
            new OpenSettings { MaxCharactersInPart = 16L * 1024 * 1024 });
        Validate(document, path);
        ValidateEmbedded(document, path, new HashSet<OpenXmlPart>());
    }
    catch (Exception ex)
    {
        Error($"UNREADABLE {path}: {ex.GetType().Name}: {ex.Message}");
    }
}
if (diagnostics > diagnosticLimit)
    Console.Error.WriteLine($"Diagnostics truncated after {diagnosticLimit} entries; validation still failed.");
Console.WriteLine($"Office2019 validation: {checkedFiles} PPTX file(s), {failures} reported error(s) (SDK capped per package at {diagnosticLimit + 1}).");
return failures == 0 ? 0 : 1;
