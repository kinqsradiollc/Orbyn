import { View } from "react-native";
import { Button } from "./Button";
import { saveFile } from "../lib/download";

export type DocumentPdfPreviewProps = {
  pdf: Blob;
  report: (error: unknown) => void;
};

/** Native clients hand the generated file to the system PDF viewer. */
export function DocumentPdfPreview({ pdf, report }: DocumentPdfPreviewProps) {
  return (
    <View>
      <Button
        title="Open PDF"
        onPress={() =>
          void saveFile("document.pdf", pdf, "application/pdf").catch(report)
        }
      />
    </View>
  );
}
