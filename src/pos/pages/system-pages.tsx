/**
 * Admin System pages inside the POS: Stock Report, Customer Report, Add Customer,
 * Order Catalog and Users. They reuse the portal's own components (same data, same
 * database tables and browser storage), styled by a copy of the portal stylesheet that
 * only applies inside .portal-embed, so the POS look is not affected.
 */
import "../portal-embed.css"
import { StockReport } from "../../components/StockReport"
import { UsersAdmin } from "../../components/UsersAdmin"
import { AdminAddCustomer, AdminProducts, CustomerReport } from "../../App"
import { can } from "../../lib/access"
import { usePosAccess } from "@/components/auth-gate"

const Embed = ({ children }: { children: React.ReactNode }) => <div className="portal-embed"><div className="ltr-mode">{children}</div></div>

export function StockReportPage() {
  const access = usePosAccess()
  return <Embed><StockReport canEdit={can(access, "stock_report")} canTransfer={can(access, "stock_transfer")} /></Embed>
}
export const CustomerReportPage = () => <Embed><CustomerReport /></Embed>
export const AddCustomerPage = () => <Embed><AdminAddCustomer language="en" /></Embed>
export const CatalogPage = () => <Embed><AdminProducts onChanged={() => undefined} /></Embed>
export const UsersPage = () => <Embed><UsersAdmin /></Embed>
