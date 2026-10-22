using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

namespace WordsActuallyDance
{
    // Explicit Unicode interface: ANSI shell automation can corrupt Chinese paths.
    [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IShellLinkW
    {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int size, IntPtr findData, uint flags);
        void GetIDList(out IntPtr list);
        void SetIDList(IntPtr list);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int size);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string value);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int size);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string value);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int size);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string value);
        void GetHotkey(out short hotkey);
        void SetHotkey(short hotkey);
        void GetShowCmd(out int command);
        void SetShowCmd(int command);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int size, out int index);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
        void Resolve(IntPtr window, uint flags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
    }

    public sealed class ShortcutInfo
    {
        public string TargetPath;
        public string Arguments;
        public string WorkingDirectory;
    }

    public static class WindowsShortcut
    {
        private static object CreateShellLink()
        {
            return Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("00021401-0000-0000-C000-000000000046")));
        }

        public static void Save(string path, string target, string arguments, string directory, string icon)
        {
            object instance = CreateShellLink();
            try
            {
                IShellLinkW link = (IShellLinkW)instance;
                link.SetPath(target);
                link.SetArguments(arguments);
                link.SetWorkingDirectory(directory);
                link.SetDescription("Words Actually Dance — latest local experiment");
                link.SetShowCmd(7);
                if (!String.IsNullOrEmpty(icon)) link.SetIconLocation(icon, 0);
                ((IPersistFile)instance).Save(path, true);
            }
            finally { Marshal.FinalReleaseComObject(instance); }
        }

        public static ShortcutInfo Read(string path)
        {
            object instance = CreateShellLink();
            try
            {
                ((IPersistFile)instance).Load(path, 0);
                IShellLinkW link = (IShellLinkW)instance;
                StringBuilder target = new StringBuilder(32768);
                StringBuilder arguments = new StringBuilder(32768);
                StringBuilder directory = new StringBuilder(32768);
                link.GetPath(target, target.Capacity, IntPtr.Zero, 0);
                link.GetArguments(arguments, arguments.Capacity);
                link.GetWorkingDirectory(directory, directory.Capacity);
                return new ShortcutInfo { TargetPath = target.ToString(), Arguments = arguments.ToString(), WorkingDirectory = directory.ToString() };
            }
            finally { Marshal.FinalReleaseComObject(instance); }
        }
    }
}
