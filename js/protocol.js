export const PACKET_SIZE = 10;

export function parsePacket(dataView) {
    if (dataView.byteLength !== PACKET_SIZE) {
        throw new Error("Falsche Paketgröße");
    }

    return {
        // Gruppe B: Infrastruktur
        infra_density:   dataView.getUint8(0),
        env_snr:         dataView.getInt8(1),
        infra_proximity: dataView.getInt8(2),

        // Gruppe C: Gefahr
        object_count:    dataView.getUint8(3),
        object_proximity:dataView.getInt8(4),
        object_spread:   dataView.getUint8(5),

        // Meta
        timestamp:       dataView.getUint32(6, true)
    };
}
