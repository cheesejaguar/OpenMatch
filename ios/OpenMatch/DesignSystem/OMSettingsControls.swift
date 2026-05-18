import SwiftUI

// Form-replacement controls. Each wraps a stock SwiftUI control with
// Botanic colors and OMFont typography so the settings stack looks
// cohesive with the rest of the app instead of falling back to system
// gray-blue grouped Form chrome.

// MARK: - OMToggle

struct OMToggle: View {
    let label: String
    var caption: String? = nil
    @Binding var isOn: Bool

    var body: some View {
        Toggle(isOn: $isOn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(OMFont.body(16, weight: .medium))
                    .foregroundStyle(OMColor.ink)
                if let caption {
                    Text(caption)
                        .font(OMFont.caption)
                        .foregroundStyle(OMColor.inkMuted)
                }
            }
        }
        .tint(OMColor.moss)
        .padding(.horizontal, OMSpacing.lg)
        .padding(.vertical, 12)
    }
}

// MARK: - OMStepper

struct OMStepper<Value: Strideable & Comparable>: View where Value.Stride: SignedInteger {
    let label: String
    var caption: String? = nil
    @Binding var value: Value
    let range: ClosedRange<Value>
    var step: Value.Stride = 1
    var format: (Value) -> String

    var body: some View {
        HStack(spacing: OMSpacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(OMFont.body(16, weight: .medium))
                    .foregroundStyle(OMColor.ink)
                if let caption {
                    Text(caption)
                        .font(OMFont.caption)
                        .foregroundStyle(OMColor.inkMuted)
                }
            }
            Spacer()
            Text(format(value))
                .font(OMFont.display(18, weight: .semibold))
                .foregroundStyle(OMColor.moss)
                .monospacedDigit()
                .frame(minWidth: 44, alignment: .trailing)
            HStack(spacing: 6) {
                stepButton(symbol: "minus") {
                    let next = value.advanced(by: -step)
                    if next >= range.lowerBound { value = next }
                }
                .disabled(value <= range.lowerBound)
                stepButton(symbol: "plus") {
                    let next = value.advanced(by: step)
                    if next <= range.upperBound { value = next }
                }
                .disabled(value >= range.upperBound)
            }
        }
        .padding(.horizontal, OMSpacing.lg)
        .padding(.vertical, 12)
    }

    private func stepButton(symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(OMColor.terracotta)
                .frame(width: 32, height: 32)
                .background(
                    Circle().fill(OMColor.surface)
                )
                .overlay(Circle().stroke(OMColor.terracotta.opacity(0.30), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - OMPicker (inline)

struct OMPicker<Value: Hashable>: View {
    let label: String
    @Binding var selection: Value
    let options: [(label: String, value: Value)]

    var body: some View {
        HStack(spacing: OMSpacing.md) {
            Text(label)
                .font(OMFont.body(16, weight: .medium))
                .foregroundStyle(OMColor.ink)
            Spacer()
            Menu {
                ForEach(options, id: \.value) { opt in
                    Button(opt.label) { selection = opt.value }
                }
            } label: {
                HStack(spacing: 4) {
                    Text(currentLabel)
                        .font(OMFont.body(15, weight: .medium))
                        .foregroundStyle(OMColor.moss)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(OMColor.moss.opacity(0.7))
                }
            }
        }
        .padding(.horizontal, OMSpacing.lg)
        .padding(.vertical, 12)
    }

    private var currentLabel: String {
        options.first(where: { $0.value == selection })?.label ?? ""
    }
}

// MARK: - OMSegmented

// Capsule selector with moss-on-bone for the active segment.
struct OMSegmented<Value: Hashable>: View {
    @Binding var selection: Value
    let options: [(label: String, value: Value)]

    var body: some View {
        HStack(spacing: 4) {
            ForEach(options, id: \.value) { opt in
                Button {
                    withAnimation(.spring(response: 0.22, dampingFraction: 0.85)) {
                        selection = opt.value
                    }
                } label: {
                    Text(opt.label)
                        .font(OMFont.body(14, weight: .semibold))
                        .padding(.vertical, 8)
                        .padding(.horizontal, 14)
                        .frame(maxWidth: .infinity)
                        .foregroundStyle(selection == opt.value ? OMColor.onAccent : OMColor.ink)
                        .background(
                            Capsule()
                                .fill(selection == opt.value ? OMColor.moss : Color.clear)
                        )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4)
        .background(
            Capsule().fill(OMColor.surfaceSunken)
        )
    }
}
