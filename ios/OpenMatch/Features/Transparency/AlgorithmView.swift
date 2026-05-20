import SwiftUI


final class AlgorithmViewModel: ObservableObject {
    @Published var data: AlgorithmTransparencyDTO?
    @Published var error: String?
    private let api: APIClient
    init(api: APIClient) { self.api = api }

    func load() async {
        do { data = try await api.algorithm() }
        catch { self.error = error.localizedDescription }
    }
}

struct AlgorithmView: View {
    @EnvironmentObject private var api: APIClient
    @StateObject private var vm = AlgorithmViewModel(api: APIClient(baseURL: APIConfig.defaultBaseURL))

    var body: some View {
        OMScreen {
            ScrollView {
                VStack(alignment: .leading, spacing: OMSpacing.lg) {
                    Text("How matching works")
                        .font(OMFont.display(28, weight: .semibold, italic: true))
                        .foregroundStyle(OMColor.ink)

                    Text("OpenMatch ranks profiles using a transparent weighted score. The same code that runs on the server is open source — you can read it, audit it, and propose changes.")
                        .font(OMFont.callout)
                        .foregroundStyle(OMColor.inkMuted)

                    if let data = vm.data {
                        HStack {
                            Label(data.algorithmVersion, systemImage: "tag.fill")
                                .foregroundStyle(OMColor.plum)
                            Spacer()
                            Text(data.rankingConfigVersion)
                                .foregroundStyle(OMColor.inkMuted)
                                .monospacedDigit()
                        }
                        .font(OMFont.caption.weight(.semibold))
                        .padding(12)
                        .background(
                            OMShape.card(OMRadius.md).fill(OMColor.surfaceElevated)
                        )
                        .overlay(
                            OMShape.card(OMRadius.md).stroke(OMColor.cardStroke, lineWidth: 1)
                        )

                        OMSection("Live weights") {
                            ForEach(Array(data.weights.sorted(by: { $0.value > $1.value }).enumerated()), id: \.element.key) { idx, kv in
                                WeightRow(name: kv.key, value: kv.value)
                                if idx < data.weights.count - 1 { OMSectionDivider() }
                            }
                        }

                        OMSection("What we never use") {
                            ForbiddenRow("Paid status / subscription tier")
                            OMSectionDivider()
                            ForbiddenRow("Hidden attractiveness scores")
                            OMSectionDivider()
                            ForbiddenRow("Inferred income or device price")
                            OMSectionDivider()
                            ForbiddenRow("Engagement-maximization predictions")
                        }

                        if let url = data.sourceUrl, let u = URL(string: url) {
                            Link(destination: u) {
                                Text("Read the source")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(OMSecondaryButtonStyle())
                            .padding(.top, 4)
                        }
                    } else {
                        ProgressView().tint(OMColor.plum)
                            .frame(maxWidth: .infinity)
                    }
                }
                .padding(OMSpacing.lg)
            }
        }
        .omNavTitle("Algorithm")
        .task { await vm.load() }
    }
}

private struct WeightRow: View {
    let name: String
    let value: Double
    var body: some View {
        HStack(spacing: OMSpacing.md) {
            Text(displayName)
                .font(OMFont.body(15, weight: .medium))
                .foregroundStyle(OMColor.ink)
            Spacer()
            ProgressView(value: value)
                .progressViewStyle(.linear)
                .tint(OMColor.magenta)
                .frame(width: 120)
            Text(String(format: "%.2f", value))
                .font(OMFont.caption)
                .monospacedDigit()
                .foregroundStyle(OMColor.inkMuted)
                .frame(width: 40, alignment: .trailing)
        }
        .padding(.horizontal, OMSpacing.lg)
        .padding(.vertical, 12)
    }
    var displayName: String {
        switch name {
        case "distance":            return "Distance"
        case "activity":            return "Recent activity"
        case "preferenceOverlap":   return "Preference overlap"
        case "relationshipGoal":    return "Relationship goal"
        case "profileCompleteness": return "Profile completeness"
        case "fairnessRotation":    return "Fairness rotation"
        case "randomization":       return "Randomization"
        default: return name
        }
    }
}

private struct ForbiddenRow: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        HStack(spacing: OMSpacing.md) {
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(OMColor.cinnabar)
            Text(text)
                .font(OMFont.callout)
                .foregroundStyle(OMColor.ink)
            Spacer()
        }
        .padding(.horizontal, OMSpacing.lg)
        .padding(.vertical, 12)
    }
}
