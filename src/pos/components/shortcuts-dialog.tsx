import { CornerDownLeftIcon, KeyboardIcon } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Kbd, KbdGroup } from "@/components/ui/kbd"

const Enter = () => (
  <Kbd>
    <CornerDownLeftIcon />
  </Kbd>
)

const SECTIONS: { title: string; rows: [React.ReactNode, string][] }[] = [
  {
    title: "Global",
    rows: [
      [<KbdGroup><Kbd>Alt</Kbd>+<Kbd>1</Kbd>…<Kbd>4</Kbd></KbdGroup>, "Switch module (POS, Rates, Items, Summary)"],
      [<KbdGroup><Kbd>F1</Kbd> or <Kbd>?</Kbd></KbdGroup>, "Show this help"],
      [<Kbd>Esc</Kbd>, "Close dialog / go back"],
    ],
  },
  {
    title: "Point of Sale",
    rows: [
      [<KbdGroup><Kbd>↑</Kbd><Kbd>↓</Kbd></KbdGroup>, "Move through the item list"],
      [<Enter />, "Pick item → enter quantity → add to cart"],
      [<KbdGroup><Enter /> on empty search</KbdGroup>, "Show total amount"],
      [<KbdGroup><Enter /> again</KbdGroup>, "Choose payment"],
      [<KbdGroup><Kbd>←</Kbd><Kbd>→</Kbd> / <Kbd>1</Kbd><Kbd>2</Kbd></KbdGroup>, "Cash or Balance"],
      [<Enter />, "Complete sale"],
      [<Kbd>P</Kbd>, "Print receipt (after sale)"],
      [<Enter />, "Start new sale (after sale)"],
      [<span className="text-xs text-muted-foreground">Click a quantity</span>, "Edit it inline (0 removes the line)"],
    ],
  },
  {
    title: "Rate Changing & Item Addition",
    rows: [
      [<Enter />, "Move to next field / save"],
    ],
  },
]

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyboardIcon className="size-4" /> Keyboard shortcuts
          </DialogTitle>
          <DialogDescription>The whole POS can be run without a mouse.</DialogDescription>
        </DialogHeader>
        <div className="-mx-4 max-h-[65vh] overflow-y-auto px-4">
          {SECTIONS.map((s) => (
            <section key={s.title} className="mb-4 last:mb-0">
              <h3 className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">{s.title}</h3>
              <div className="divide-y rounded-lg border">
                {s.rows.map(([keys, label], i) => (
                  <div key={i} className="flex items-center justify-between gap-4 px-3 py-2 text-sm">
                    <span>{label}</span>
                    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">{keys}</span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
