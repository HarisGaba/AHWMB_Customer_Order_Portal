import { useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { ArrowRightIcon, ChevronsUpDownIcon, CornerDownLeftIcon, SearchIcon, TagIcon } from "lucide-react"
import { ItemCommand } from "@/components/item-command"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { actions, fmt, useStore, type Item } from "@/lib/store"
import { cn } from "@/lib/utils"

export function RatesPage() {
  const allItems = useStore((s) => s.items)
  const items = useMemo(() => allItems.filter((i) => !i.archivedAt), [allItems])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [rate, setRate] = useState("")
  const [flashId, setFlashId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const rateRef = useRef<HTMLInputElement>(null)

  const selected = items.find((i) => i.id === selectedId) ?? null
  const visible = useMemo(
    () => items.filter((i) => i.name.toLowerCase().includes(filter.trim().toLowerCase())),
    [items, filter],
  )

  function select(item: Item) {
    setSelectedId(item.id)
    setRate(String(item.rate))
    setPickerOpen(false)
    setSearch("")
    setTimeout(() => rateRef.current?.select(), 50)
  }

  async function save() {
    if (!selected || saving) return setPickerOpen(!selected)
    const r = parseFloat(rate)
    if (rate.trim() === "" || !(r >= 0)) return void toast.error("Enter a valid rate")
    if (r === selected.rate) return void toast.info("Rate unchanged")
    setSaving(true)
    try {
      await actions.updateRate(selected.id, r)
    } catch (e) {
      return void toast.error("Rate not saved", { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
    toast.success(`Rate updated · ${selected.name}`, { description: `${fmt(selected.rate)} → ${fmt(r)}` })
    setFlashId(selected.id)
    setTimeout(() => setFlashId(null), 1500)
    setSelectedId(null)
    setRate("")
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Rate Changing" description="Select an item, change its rate and press Enter. The new rate applies everywhere instantly." />

      <Card className="shadow-xs">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><TagIcon className="size-4" /> Update rate</CardTitle>
          <CardDescription>Click an item in the table below or open the item picker.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid items-end gap-4 md:grid-cols-[1fr_auto_200px_auto]">
            <div className="grid gap-2">
              <Label>Item</Label>
              <Button variant="outline" className="h-10 justify-between font-normal" onClick={() => setPickerOpen(true)}>
                {selected ? <span className="font-medium">{selected.name}</span> : <span className="text-muted-foreground">Select item…</span>}
                <ChevronsUpDownIcon className="opacity-50" />
              </Button>
            </div>
            <div className="hidden h-10 items-center text-sm text-muted-foreground md:flex">
              {selected && <span className="font-mono">{fmt(selected.rate)}</span>}
              <ArrowRightIcon className="mx-2 size-4" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-rate">New rate</Label>
              <Input
                id="new-rate"
                ref={rateRef}
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={rate}
                disabled={!selected}
                onChange={(e) => setRate(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void save()}
                className="h-10 text-right font-mono text-base"
              />
            </div>
            <Button size="lg" className="h-10" disabled={!selected || saving} onClick={() => void save()}>
              Save <Kbd className="bg-primary-foreground/15 text-primary-foreground"><CornerDownLeftIcon /></Kbd>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="gap-0 py-0 shadow-xs">
        <div className="flex items-center gap-3 border-b p-4">
          <div className="relative max-w-sm flex-1">
            <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter items…" className="pl-9" />
          </div>
          <span className="ml-auto text-sm text-muted-foreground">{visible.length} of {items.length} items</span>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Item</TableHead>
              <TableHead className="pr-4 text-right">Rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((item) => (
              <TableRow
                key={item.id}
                onClick={() => select(item)}
                data-state={item.id === selectedId ? "selected" : undefined}
                className={cn("cursor-pointer transition-colors", flashId === item.id && "bg-emerald-500/10")}
              >
                <TableCell className="pl-4 font-medium">{item.name}</TableCell>
                <TableCell className="pr-4 text-right font-mono tabular-nums">{fmt(item.rate)}</TableCell>
              </TableRow>
            ))}
            {!visible.length && (
              <TableRow>
                <TableCell colSpan={2} className="py-10 text-center text-muted-foreground">
                  {items.length ? "No items match your filter." : "No items yet. Add some in Item Addition."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="gap-3 p-3 sm:max-w-lg" showCloseButton={false} finalFocus={rateRef}>
          <DialogHeader className="px-1 pt-1">
            <DialogTitle>Select item</DialogTitle>
          </DialogHeader>
          <ItemCommand search={search} onSearchChange={setSearch} onPick={select} selectedId={selectedId ?? undefined} listClassName="max-h-96" />
        </DialogContent>
      </Dialog>
    </div>
  )
}
