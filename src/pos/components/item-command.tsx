import { useMemo } from "react"
import { PackageIcon } from "lucide-react"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { fmt, useStore, type Item } from "@/lib/store"
import { cn } from "@/lib/utils"

type Props = {
  search: string
  onSearchChange: (v: string) => void
  onPick: (item: Item) => void
  inputRef?: React.Ref<HTMLInputElement>
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>
  selectedId?: string
  className?: string
  listClassName?: string
  placeholder?: string
}

/** Searchable, keyboard-driven item list shared by POS and Rate Changing. */
export function ItemCommand({
  search,
  onSearchChange,
  onPick,
  inputRef,
  onKeyDown,
  selectedId,
  className,
  listClassName,
  placeholder = "Search items…",
}: Props) {
  const all = useStore((s) => s.items)
  const items = useMemo(() => all.filter((i) => !i.archivedAt), [all])
  return (
    <Command
      onKeyDown={onKeyDown}
      className={cn("rounded-xl! border bg-card", className)}
      filter={(_value, q, keywords) => ((keywords?.[0] ?? "").toLowerCase().includes(q.trim().toLowerCase()) ? 1 : 0)}
    >
      <CommandInput ref={inputRef} value={search} onValueChange={onSearchChange} placeholder={placeholder} className="h-10" />
      <CommandList className={cn("max-h-none flex-1", listClassName)}>
        <CommandEmpty>
          {items.length ? "No matching items." : "No items yet — add some in Item Addition."}
        </CommandEmpty>
        <CommandGroup heading={`${items.length} items`}>
          {items.map((item) => (
            <CommandItem
              key={item.id}
              value={`${item.name}__${item.id}`}
              keywords={[item.name]}
              onSelect={() => onPick(item)}
              data-checked={item.id === selectedId}
              className="py-2.5"
            >
              <div className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <PackageIcon className="size-3.5" />
              </div>
              <span className="truncate font-medium">{item.name}</span>
              <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">{fmt(item.rate)}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}
