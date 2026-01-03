import { AssetInventory } from "@/components/asm/AssetInventory";
import { Server } from "lucide-react";
import { motion } from "framer-motion";

export default function Assets() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div>
          <h1 className="text-2xl lg:text-3xl font-heading font-bold text-foreground flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10">
              <Server className="w-6 h-6 text-primary" />
            </div>
            Asset Inventory
          </h1>
          <p className="text-muted-foreground mt-1">Manage and monitor all your organization's assets</p>
        </div>
      </motion.div>

      <AssetInventory />
    </div>
  );
}