import { useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { formatDistanceToNow } from "date-fns"
import { ArchiveIcon, ArchiveRestoreIcon, CornerDownLeftIcon, PackagePlusIcon, SearchIcon, Trash2Icon } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { actions, fmt, useStore, type Item } from "@/lib/store"

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function AddItemPage() {
  const items = useStore((s) => s.items)
  const [name, setName] = useState("")
  const [rate, setRate] = useState("")
  const [nameUr, setNameUr] = useState("")
  const [unitWeight, setUnitWeight] = useState("1")
  const [filter, setFilter] = useState("")
  const [view, setView] = useState<"active" | "archived">("active")
  const [lastAdded, setLastAdded] = useState<string | null>(null)
  const [toDelete, setToDelete] = useState<Item | null>(null)
  const [saving, setSaving] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const rateRef = useRef<HTMLInputElement>(null)
  const urRef = useRef<HTMLInputElement>(null)
  const weightRef = useRef<HTMLInputElement>(null)

  const active = useMemo(() => items.filter((i) => !i.archivedAt), [items])
  const archived = useMemo(() => items.filter((i) => i.archivedAt), [items])
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (view === "active" ? active : archived).filter((i) => i.name.toLowerCase().includes(q) || (i.nameUr ?? "").includes(filter.trim()))
  }, [view, active, archived, filter])

  async function save() {
    if (saving) return
    const n = name.trim()
    const r = parseFloat(rate)
    if (!n) return nameRef.current?.focus()
    const existing = actions.findByName(n)
    if (existing) {
      if (existing.archivedAt)
        toast.error(`"${existing.name}" is archived`, {
          description: "Restore it instead of adding it again.",
          action: { label: "Restore", onClick: () => void restore(existing) },
          duration: 6000,
        })
      else toast.error(`"${existing.name}" already exists`, { description: "Use Rate Changing to update its rate." })
      return nameRef.current?.select()
    }
    if (rate.trim() === "" || !(r >= 0)) {
      toast.error("Enter a valid rate")
      return rateRef.current?.focus()
    }
    const w = parseFloat(unitWeight)
    if (!(w > 0)) {
      toast.error("Enter the weight of one unit in kg", { description: "Use 1 if the item is sold by the kg." })
      return weightRef.current?.focus()
    }
    setSaving(true)
    let item: Item
    try {
      item = await actions.addItem(n, r, nameUr, w)
    } catch (e) {
      return void toast.error("Item not saved", { description: errMsg(e) })
    } finally {
      setSaving(false)
    }
    toast.success(`Added ${item.name}`, { description: `${fmt(r)} · now available in POS` })
    setLastAdded(item.id)
    setName("")
    setRate("")
    setNameUr("")
    setUnitWeight("1")
    nameRef.current?.focus()
  }

  async function archive(item: Item) {
    try {
      await actions.archiveItem(item.id)
      toast.success(`Archived ${item.name}`, {
        description: "Hidden from the POS.",
        action: { label: "Undo", onClick: () => void restore(item) },
        duration: 6000,
      })
    } catch (e) {
      toast.error("Archive failed", { description: errMsg(e) })
    }
  }

  async function restore(item: Item) {
    try {
      await actions.restoreItem(item.id)
      toast.success(`Restored ${item.name}`)
    } catch (e) {
      toast.error("Restore failed", { description: errMsg(e) })
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Item Addition" description="Add new items with their rate. They become available in the POS immediately." />

      <Card className="rounded-2xl shadow-panel">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PackagePlusIcon className="size-4" /> New item
          </CardTitle>
          <CardDescription>Type each field and press Enter to move to the next. Weight per unit is used for the Total Weight on bills (1 = sold by the kg).</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid items-end gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_150px_150px_auto]">
            <div className="grid gap-2">
              <Label htmlFor="item-name">Item Name</Label>
              <Input
                id="item-name"
                ref={nameRef}
                autoFocus
                autoComplete="off"
                placeholder="e.g. Milk 1L"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim()) urRef.current?.focus()
                }}
                className="h-10 text-base"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="item-name-ur">Urdu Name</Label>
              <Input
                id="item-name-ur"
                ref={urRef}
                dir="rtl"
                lang="ur"
                autoComplete="off"
                placeholder="مثلاً چنا دال"
                value={nameUr}
                onChange={(e) => setNameUr(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && rateRef.current?.focus()}
                className="font-urdu h-10 text-base"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="item-rate">Rate</Label>
              <Input
                id="item-rate"
                ref={rateRef}
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                placeholder="0.00"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && weightRef.current?.select()}
                className="h-10 text-right font-mono text-base"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="item-weight">Weight / unit (kg)</Label>
              <Input
                id="item-weight"
                ref={weightRef}
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={unitWeight}
                onChange={(e) => setUnitWeight(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void save()}
                className="h-10 text-right font-mono text-base"
              />
            </div>
            <Button size="lg" className="h-10" disabled={saving} onClick={() => void save()}>
              Save item
              <Kbd className="bg-primary-foreground/15 text-primary-foreground">
                <CornerDownLeftIcon />
              </Kbd>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="gap-0 py-0 rounded-2xl shadow-panel">
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <Tabs value={view} onValueChange={(v) => setView(v as "active" | "archived")}>
            <TabsList>
              <TabsTrigger value="active">
                Active <Badge variant="secondary">{active.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="archived">
                Archived <Badge variant="secondary">{archived.length}</Badge>
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative ml-auto w-full max-w-xs">
            <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter items…" className="pl-9" />
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Item Name</TableHead>
              <TableHead>Urdu Name</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">Weight / unit</TableHead>
              <TableHead className="hidden md:table-cell">{view === "active" ? "Added" : "Archived"}</TableHead>
              <TableHead className="w-0 pr-4" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((item) => (
              <TableRow key={item.id} className="group/row">
                <TableCell className="pl-4 font-medium">
                  {item.name}
                  {item.id === lastAdded && (
                    <Badge className="ml-2" variant="secondary">
                      New
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <EditableCell
                    value={item.nameUr ?? ""}
                    placeholder="+ Add Urdu"
                    urdu
                    onSave={(v) => actions.updateDetails(item.id, { nameUr: v })}
                  />
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">{fmt(item.rate)}</TableCell>
                <TableCell className="text-right">
                  <EditableCell
                    value={String(item.unitWeight)}
                    suffix=" kg"
                    numeric
                    onSave={(v) => {
                      const w = parseFloat(v)
                      if (!(w > 0)) throw new Error("Weight must be above 0")
                      return actions.updateDetails(item.id, { unitWeight: w })
                    }}
                  />
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">
                  {formatDistanceToNow(new Date(item.archivedAt ?? item.createdAt), { addSuffix: true })}
                </TableCell>
                <TableCell className="pr-4">
                  <div className="flex justify-end gap-1">
                    {view === "active" ? (
                      <Button variant="ghost" size="sm" className="opacity-60 group-hover/row:opacity-100" onClick={() => void archive(item)}>
                        <ArchiveIcon /> Archive
                      </Button>
                    ) : (
                      <>
                        <Button variant="outline" size="sm" onClick={() => void restore(item)}>
                          <ArchiveRestoreIcon /> Restore
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label={`Delete ${item.name} permanently`} onClick={() => setToDelete(item)}>
                          <Trash2Icon />
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!visible.length && (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                  {filter
                    ? "No items match your filter."
                    : view === "active"
                      ? "Your catalogue is empty. Add your first item above."
                      : "No archived items. Archived items are hidden from the POS and can be restored here."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{toDelete?.name}” permanently?</AlertDialogTitle>
            <AlertDialogDescription>This can’t be undone. Past sales that include it are kept.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                const item = toDelete
                setToDelete(null)
                if (!item) return
                try {
                  await actions.deleteItemForever(item.id)
                  toast.success(`Deleted ${item.name}`)
                } catch (e) {
                  toast.error("Delete failed", { description: errMsg(e) })
                }
              }}
            >
              Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** Click to edit; Enter or blur saves, Esc cancels. */
function EditableCell({
  value,
  onSave,
  placeholder = "—",
  suffix = "",
  urdu,
  numeric,
}: {
  value: string
  onSave: (v: string) => Promise<void>
  placeholder?: string
  suffix?: string
  urdu?: boolean
  numeric?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  const commit = async () => {
    setEditing(false)
    if (draft.trim() === value.trim()) return
    try {
      await onSave(draft)
      toast.success("Saved")
    } catch (e) {
      toast.error("Not saved", { description: errMsg(e) })
    }
  }

  if (!editing)
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(value)
          setEditing(true)
        }}
        dir={urdu ? "rtl" : undefined}
        lang={urdu ? "ur" : undefined}
        className={`rounded-md border border-transparent px-2 py-1 transition-colors hover:border-border hover:bg-muted ${urdu ? "font-urdu" : "font-mono tabular-nums"} ${value ? "" : "text-muted-foreground"}`}
      >
        {value ? `${value}${suffix}` : placeholder}
      </button>
    )

  return (
    <Input
      autoFocus
      dir={urdu ? "rtl" : undefined}
      lang={urdu ? "ur" : undefined}
      type={numeric ? "number" : "text"}
      step="any"
      value={draft}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") void commit()
        else if (e.key === "Escape") setEditing(false)
      }}
      className={`h-9 ${urdu ? "font-urdu w-44" : "ml-auto w-24 text-right font-mono"}`}
    />
  )
}
