import {
  ArrowLeft, ArrowUp, AtSign, Bell, BookOpen, Building2, Calendar, ChartColumn, Check, ChevronDown, ChevronLeft, Clock, Cloud,
  Download, Eye, FileText, Flag, GraduationCap, Headset, House, Info, Laptop, LifeBuoy, Lock, LogOut, Menu, Mic, PanelLeftClose,
  PanelLeftOpen, Paperclip, Plus, RefreshCw, RotateCcw, Search, Send, Settings, Sparkles, Square, Target, User, UserRound, Users,
  Wallet, X, type LucideIcon,
} from 'lucide-react';

/** Lucide icons, the set the NPST portal uses, under the names the app already calls them by. */
const ICONS: Record<string, LucideIcon> = {
  home: House, user: User, clock: Clock, cal: Calendar, wallet: Wallet, book: BookOpen, target: Target, help: LifeBuoy, gear: Settings,
  plus: Plus, search: Search, bell: Bell, flag: Flag, lock: Lock, clip: Paperclip, x: X, back: ChevronLeft, up: ArrowUp, at: AtSign,
  eye: Eye, check: Check, file: FileText, users: Users, refresh: RefreshCw, down: Download, chev: ChevronDown, reopen: RotateCcw,
  cloud: Cloud, cap: GraduationCap, hr: UserRound, info: Info, laptop: Laptop, building: Building2, mic: Mic, send: Send, stop: Square,
  spark: Sparkles, chart: ChartColumn, headset: Headset, menu: Menu, collapse: PanelLeftClose, expand: PanelLeftOpen, portal: ArrowLeft,
  logout: LogOut,
};

export function Icon({ n, s = 16 }: { n: string; s?: number }) {
  const C = ICONS[n];
  return C ? <C size={s} strokeWidth={2} aria-hidden="true" /> : null;
}
