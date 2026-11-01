export function PageHeader({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="flex items-center gap-3 font-heading text-2xl font-bold tracking-tight md:text-[1.7rem]">
          <span aria-hidden className="h-7 w-1.5 rounded-full bg-gradient-to-b from-gold to-primary" />
          {title}
        </h1>
        {description && <p className="mt-1.5 pl-[18px] text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  )
}
